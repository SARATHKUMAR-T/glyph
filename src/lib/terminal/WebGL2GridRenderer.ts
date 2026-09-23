import {
  cellText,
  CellFlags,
  ALL_UNDERLINE_FLAGS,
  decodeFrame,
  FrameKind,
  MouseTrackingLevel,
  WireCursorShape,
  type DecodedCell,
  type DecodedFrame,
  type MouseMode,
} from "./engineProtocol";
import type { GridRenderer, SelectionRange } from "./GridRenderer";
import { measureCellMetrics } from "./CanvasGridRenderer";
import { GlyphAtlas } from "./webgl/glyphAtlas";

interface RendererOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

const BLANK_CELL: DecodedCell = { codepoint: 0x20, fg: 0xf5f5f5ff, bg: 0x00000000, flags: 0, extra: [] };

// ---- Shaders -----------------------------------------------------------
//
// Two programs, both instanced off one shared unit-quad VBO:
//
// 1. `solid` — flat-colored quads. Used for cell backgrounds (one instance
//    per cell, every frame) and for underline/strikethrough/cursor bars
//    (a handful of instances, only the cells that need them).
// 2. `glyph` — textured quads sampling the shared glyph atlas, tinted by
//    a per-instance foreground color in the fragment shader. The atlas
//    stores glyphs as white-on-transparent, so texel.a is pure coverage
//    and any color can reuse the same atlas slot (see glyphAtlas.ts).
//
// Both together, redrawn every animation frame, are the renderer's
// "instanced quads, small fixed number of draw calls per frame" approach:
// one draw call for every cell's background, one for every visible
// glyph, one for decorations + cursor — not one draw call per cell.

const SOLID_VS = `#version 300 es
in vec2 a_corner;
in vec2 a_cellPos;
in vec2 a_cellSpan;
in vec4 a_color;
uniform vec2 u_resolution;
uniform vec2 u_cellSize;
out vec4 v_color;
void main() {
  vec2 pixel = (a_cellPos + a_corner * a_cellSpan) * u_cellSize;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const SOLID_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}`;

const GLYPH_VS = `#version 300 es
in vec2 a_corner;
in vec2 a_cellPos;
in vec2 a_cellSpan;
in vec4 a_uv;
in vec4 a_fg;
uniform vec2 u_resolution;
uniform vec2 u_cellSize;
out vec2 v_texcoord;
out vec4 v_color;
void main() {
  vec2 pixel = (a_cellPos + a_corner * a_cellSpan) * u_cellSize;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_texcoord = mix(a_uv.xy, a_uv.zw, a_corner);
  v_color = a_fg;
}`;

const GLYPH_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_texcoord;
in vec4 v_color;
out vec4 outColor;
void main() {
  float coverage = texture(u_atlas, v_texcoord).a;
  outColor = vec4(v_color.rgb, v_color.a * coverage);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("failed to create program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const SOLID_STRIDE = 8; // cellPos(2) + cellSpan(2) + color(4)
const GLYPH_STRIDE = 12; // cellPos(2) + cellSpan(2) + uv(4) + fg(4)

export class WebGL2GridRenderer implements GridRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private opts: RendererOptions;
  private atlas: GlyphAtlas;

  private solidProgram: WebGLProgram;
  private glyphProgram: WebGLProgram;
  private quadVbo: WebGLBuffer;

  private solidVao: WebGLVertexArrayObject;
  private solidInstanceVbo: WebGLBuffer;
  private glyphVao: WebGLVertexArrayObject;
  private glyphInstanceVbo: WebGLBuffer;
  private decoVao: WebGLVertexArrayObject;
  private decoInstanceVbo: WebGLBuffer;

  private solidUniforms: { resolution: WebGLUniformLocation | null; cellSize: WebGLUniformLocation | null };
  private glyphUniforms: {
    resolution: WebGLUniformLocation | null;
    cellSize: WebGLUniformLocation | null;
    atlas: WebGLUniformLocation | null;
  };

  private cols = 0;
  private rows = 0;
  private cellWidth = 0;
  private cellHeight = 0;
  private dpr = 1;

  private grid: DecodedCell[] = [];
  private text: string[] = [];

  private cursor = {
    col: 0,
    line: 0,
    shape: WireCursorShape.Block as WireCursorShape,
    visible: true,
    blinkOn: true,
  };
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private focused = true;
  private rafHandle = 0;
  private dirty = true;
  private disposed = false;

  private displayOffset = 0;
  private historySize = 0;
  private mouseMode: MouseMode = { tracking: MouseTrackingLevel.Off, sgr: false };
  private selection: SelectionRange | null = null;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.opts = opts;

    this.solidProgram = link(gl, SOLID_VS, SOLID_FS);
    this.glyphProgram = link(gl, GLYPH_VS, GLYPH_FS);

    const quadVbo = gl.createBuffer();
    if (!quadVbo) throw new Error("failed to create quad VBO");
    this.quadVbo = quadVbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);

    const solidInstanceVbo = gl.createBuffer();
    const glyphInstanceVbo = gl.createBuffer();
    const decoInstanceVbo = gl.createBuffer();
    if (!solidInstanceVbo || !glyphInstanceVbo || !decoInstanceVbo) {
      throw new Error("failed to create instance VBOs");
    }
    this.solidInstanceVbo = solidInstanceVbo;
    this.glyphInstanceVbo = glyphInstanceVbo;
    this.decoInstanceVbo = decoInstanceVbo;

    this.solidVao = this.buildSolidVao(this.solidProgram, this.solidInstanceVbo);
    this.decoVao = this.buildSolidVao(this.solidProgram, this.decoInstanceVbo);
    this.glyphVao = this.buildGlyphVao();

    this.solidUniforms = {
      resolution: gl.getUniformLocation(this.solidProgram, "u_resolution"),
      cellSize: gl.getUniformLocation(this.solidProgram, "u_cellSize"),
    };
    this.glyphUniforms = {
      resolution: gl.getUniformLocation(this.glyphProgram, "u_resolution"),
      cellSize: gl.getUniformLocation(this.glyphProgram, "u_cellSize"),
      atlas: gl.getUniformLocation(this.glyphProgram, "u_atlas"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Cell metrics must exist before the atlas can size its raster canvas.
    const { cellWidth, cellHeight } = measureCellMetrics(opts.fontFamily, opts.fontSize, opts.lineHeight);
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    this.atlas = new GlyphAtlas(gl, { fontFamily: opts.fontFamily, fontSize: opts.fontSize, cellWidth, cellHeight });

    this.rafHandle = requestAnimationFrame(this.frameLoop);
  }

  private buildSolidVao(program: WebGLProgram, instanceVbo: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("failed to create VAO");
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    const corner = gl.getAttribLocation(program, "a_corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    const stride = SOLID_STRIDE * 4;
    const cellPos = gl.getAttribLocation(program, "a_cellPos");
    gl.enableVertexAttribArray(cellPos);
    gl.vertexAttribPointer(cellPos, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(cellPos, 1);

    const cellSpan = gl.getAttribLocation(program, "a_cellSpan");
    gl.enableVertexAttribArray(cellSpan);
    gl.vertexAttribPointer(cellSpan, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(cellSpan, 1);

    const color = gl.getAttribLocation(program, "a_color");
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(color, 4, gl.FLOAT, false, stride, 4 * 4);
    gl.vertexAttribDivisor(color, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  private buildGlyphVao(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("failed to create VAO");
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    const corner = gl.getAttribLocation(this.glyphProgram, "a_corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstanceVbo);
    const stride = GLYPH_STRIDE * 4;
    const cellPos = gl.getAttribLocation(this.glyphProgram, "a_cellPos");
    gl.enableVertexAttribArray(cellPos);
    gl.vertexAttribPointer(cellPos, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(cellPos, 1);

    const cellSpan = gl.getAttribLocation(this.glyphProgram, "a_cellSpan");
    gl.enableVertexAttribArray(cellSpan);
    gl.vertexAttribPointer(cellSpan, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(cellSpan, 1);

    const uv = gl.getAttribLocation(this.glyphProgram, "a_uv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 4, gl.FLOAT, false, stride, 4 * 4);
    gl.vertexAttribDivisor(uv, 1);

    const fg = gl.getAttribLocation(this.glyphProgram, "a_fg");
    gl.enableVertexAttribArray(fg);
    gl.vertexAttribPointer(fg, 4, gl.FLOAT, false, stride, 8 * 4);
    gl.vertexAttribDivisor(fg, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  setGrid(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, cols * this.cellWidth * this.dpr);
    this.canvas.height = Math.max(1, rows * this.cellHeight * this.dpr);
    this.canvas.style.width = `${cols * this.cellWidth}px`;
    this.canvas.style.height = `${rows * this.cellHeight}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this.grid = new Array(cols * rows).fill(BLANK_CELL);
    this.text = new Array(cols * rows).fill(" ");
    this.dirty = true;
  }

  getCellMetrics() {
    return { cellWidth: this.cellWidth, cellHeight: this.cellHeight };
  }

  getDisplayOffset() {
    return this.displayOffset;
  }

  getMouseMode() {
    return this.mouseMode;
  }

  getHistorySize() {
    return this.historySize;
  }

  getRowText(row: number): string {
    if (row < 0 || row >= this.rows) return "";
    const base = row * this.cols;
    let text = "";
    for (let col = 0; col < this.cols; col++) {
      if (this.grid[base + col].flags & CellFlags.WIDE_CHAR_SPACER) continue;
      text += this.text[base + col];
    }
    return text;
  }

  getCursorPosition() {
    return { row: this.cursor.line, col: this.cursor.col };
  }

  setSelection(range: SelectionRange | null) {
    this.selection = range;
    this.dirty = true;
  }

  /** Reads a live CSS custom property off the canvas (so per-theme
   * `<html>` overrides — see `useTerminalTheme` — apply here too) and
   * parses it into normalized `[r, g, b, a]` floats for the instanced
   * solid-quad pipeline. Mirrors `CanvasGridRenderer`'s `themeColor`,
   * which can hand its string result straight to a 2D context and so
   * doesn't need the parsing step. */
  private themeColor(varName: string, fallback: string): [number, number, number, number] {
    const value = getComputedStyle(this.canvas).getPropertyValue(varName).trim();
    return parseCssColor(value || fallback);
  }

  /** Same shape/semantics as `CanvasGridRenderer`'s — see that file's
   * comment for the row/column math (inclusive `sel` columns in, a
   * [fromCol, toCol) exclusive span out). */
  private selectionColsForRow(row: number): [number, number] | null {
    const sel = this.selection;
    if (!sel) return null;
    const top = Math.min(sel.startRow, sel.endRow);
    const bottom = Math.max(sel.startRow, sel.endRow);
    if (row < top || row > bottom) return null;

    if (sel.block) {
      return [Math.min(sel.startCol, sel.endCol), Math.max(sel.startCol, sel.endCol) + 1];
    }

    const startIsTop = sel.startRow <= sel.endRow;
    const leadCol = startIsTop ? sel.startCol : sel.endCol;
    const trailCol = startIsTop ? sel.endCol : sel.startCol;

    if (top === bottom) return [Math.min(leadCol, trailCol), Math.max(leadCol, trailCol) + 1];
    if (row === top) return [leadCol, this.cols];
    if (row === bottom) return [0, trailCol + 1];
    return [0, this.cols];
  }

  setBlinkEnabled(enabled: boolean) {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    this.cursor.blinkOn = true;
    if (enabled) {
      this.blinkTimer = setInterval(() => {
        this.cursor.blinkOn = !this.cursor.blinkOn;
        this.dirty = true;
      }, 530);
    }
  }

  setFocused(focused: boolean) {
    if (this.focused === focused) return;
    this.focused = focused;
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    cancelAnimationFrame(this.rafHandle);
    const gl = this.gl;
    gl.deleteProgram(this.solidProgram);
    gl.deleteProgram(this.glyphProgram);
    gl.deleteBuffer(this.quadVbo);
    gl.deleteBuffer(this.solidInstanceVbo);
    gl.deleteBuffer(this.glyphInstanceVbo);
    gl.deleteBuffer(this.decoInstanceVbo);
    gl.deleteVertexArray(this.solidVao);
    gl.deleteVertexArray(this.glyphVao);
    gl.deleteVertexArray(this.decoVao);
    this.atlas.dispose();
  }

  applyFrameBytes(data: ArrayBuffer | Uint8Array) {
    const frame = decodeFrame(data);
    this.applyFrame(frame);
  }

  applyFrame(frame: DecodedFrame) {
    if (frame.cols !== this.cols || frame.rows !== this.rows) {
      this.setGrid(frame.cols, frame.rows);
    }

    if (frame.kind === FrameKind.Full) {
      this.grid.fill(BLANK_CELL);
      this.text.fill(" ");
    }

    for (const row of frame.rowRecords) {
      const base = row.row * this.cols;
      for (let i = 0; i < row.cells.length; i++) {
        const col = row.startCol + i;
        if (col >= this.cols) break;
        const cell = row.cells[i];
        this.grid[base + col] = cell;
        this.text[base + col] = cellText(cell);
      }
    }

    // Reset the blink phase to "on" only when the cursor actually moved or
    // changed visibility/shape — matching real terminals' convention that
    // typing/cursor movement restarts the blink so feedback is immediate,
    // without needing to wait out an "off" phase. Resetting unconditionally
    // on every frame (as this used to) defeats blinking entirely for any
    // shell with periodic redraws unrelated to the cursor — a live clock
    // or git status in the prompt, a tmux status bar, etc. — since frames
    // keep arriving faster than the 530ms blink period ever gets to hide it.
    if (
      this.cursor.col !== frame.cursorCol ||
      this.cursor.line !== frame.cursorLine ||
      this.cursor.visible !== frame.cursorVisible ||
      this.cursor.shape !== frame.cursorShape
    ) {
      this.cursor.blinkOn = true;
    }
    this.cursor.col = frame.cursorCol;
    this.cursor.line = frame.cursorLine;
    this.cursor.shape = frame.cursorShape;
    this.cursor.visible = frame.cursorVisible;
    this.displayOffset = frame.displayOffset;
    this.historySize = Math.max(0, frame.totalLines - frame.rows);
    this.mouseMode = frame.mouseMode;
    this.dirty = true;
  }

  private frameLoop = () => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    this.rafHandle = requestAnimationFrame(this.frameLoop);
  };

  private resolvedBg(cell: DecodedCell): number {
    return (cell.flags & CellFlags.INVERSE) !== 0 ? cell.fg : cell.bg;
  }

  private resolvedFg(cell: DecodedCell): number {
    return (cell.flags & CellFlags.INVERSE) !== 0 ? cell.bg : cell.fg;
  }

  private draw() {
    const gl = this.gl;
    const { cols, rows, cellWidth, cellHeight } = this;
    if (cols === 0 || rows === 0) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // A found search match is painted as an opaque per-theme "highlighter"
    // (see `--glyph-search-match`/`-fg`) baked straight into the
    // background/glyph passes below, rather than as a translucent overlay
    // quad — that way it reads as an unmistakable highlight no matter what
    // the matched text's own fg/bg happened to be, instead of just tinting
    // whatever was already there. Plain drag selection (`kind !== "search"`)
    // is baked in here too now (alpha-composited over the cell's own
    // background), so it sits *behind* the glyph pass below and the glyph's
    // own fg color stays visible on top — like a real background layer,
    // the same way normal terminal emulators render a selection highlight
    // — instead of a translucent quad drawn over already-rendered text,
    // which just dulled the glyphs and barely read as "filled".
    const searchMatchBg = this.selection?.kind === "search" ? this.themeColor("--glyph-search-match", "#ffcc00") : null;
    const searchMatchFg = this.selection?.kind === "search" ? this.themeColor("--glyph-search-match-fg", "#040406") : null;
    const plainSelectionBg =
      this.selection && this.selection.kind !== "search" ? this.themeColor("--glyph-selection-bg", "rgba(255, 48, 48, 0.35)") : null;

    // --- Backgrounds: exactly cols*rows instances, always. ---
    const bg = new Float32Array(cols * rows * SOLID_STRIDE);
    for (let row = 0; row < rows; row++) {
      const searchCols = searchMatchBg ? this.selectionColsForRow(row) : null;
      const selCols = plainSelectionBg ? this.selectionColsForRow(row) : null;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const cell = this.grid[idx];
        let [r, g, b, a] =
          searchCols && col >= searchCols[0] && col < searchCols[1] ? searchMatchBg! : unpackRgba(this.resolvedBg(cell));
        if (selCols && col >= selCols[0] && col < selCols[1] && !(searchCols && col >= searchCols[0] && col < searchCols[1])) {
          const [sr, sg, sb, sa] = plainSelectionBg!;
          const outA = sa + a * (1 - sa);
          if (outA > 0) {
            r = (sr * sa + r * a * (1 - sa)) / outA;
            g = (sg * sa + g * a * (1 - sa)) / outA;
            b = (sb * sa + b * a * (1 - sa)) / outA;
          }
          a = outA;
        }
        const o = idx * SOLID_STRIDE;
        bg[o] = col;
        bg[o + 1] = row;
        bg[o + 2] = 1;
        bg[o + 3] = 1;
        bg[o + 4] = r;
        bg[o + 5] = g;
        bg[o + 6] = b;
        bg[o + 7] = a;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidInstanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, bg, gl.DYNAMIC_DRAW);

    gl.useProgram(this.solidProgram);
    gl.bindVertexArray(this.solidVao);
    gl.uniform2f(this.solidUniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.solidUniforms.cellSize, cellWidth * this.dpr, cellHeight * this.dpr);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);

    // --- Glyphs: one instance per non-blank, non-spacer, non-hidden cell. ---
    const glyphData: number[] = [];
    for (let row = 0; row < rows; row++) {
      const searchCols = searchMatchFg ? this.selectionColsForRow(row) : null;
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const cell = this.grid[idx];
        if (cell.flags & CellFlags.WIDE_CHAR_SPACER) continue;
        if (cell.flags & CellFlags.HIDDEN) continue;
        const text = this.text[idx];
        if (!text || text === " ") continue;

        const wide = (cell.flags & CellFlags.WIDE_CHAR) !== 0;
        const bold = (cell.flags & CellFlags.BOLD) !== 0;
        const italic = (cell.flags & CellFlags.ITALIC) !== 0;
        const rect = this.atlas.getRect(text, bold, italic, wide);
        if (!rect) continue;

        const inSearchMatch = searchCols !== null && col >= searchCols[0] && col < searchCols[1];
        const [r, g, b, a] = inSearchMatch ? searchMatchFg! : unpackRgba(this.resolvedFg(cell));
        const dim = !inSearchMatch && (cell.flags & CellFlags.DIM) !== 0;
        glyphData.push(
          col,
          row,
          rect.cellSpan,
          1,
          rect.u0,
          rect.v0,
          rect.u1,
          rect.v1,
          r,
          g,
          b,
          dim ? a * 0.65 : a,
        );
      }
    }
    if (glyphData.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphInstanceVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(glyphData), gl.DYNAMIC_DRAW);

      gl.useProgram(this.glyphProgram);
      gl.bindVertexArray(this.glyphVao);
      gl.uniform2f(this.glyphUniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.glyphUniforms.cellSize, cellWidth * this.dpr, cellHeight * this.dpr);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
      gl.uniform1i(this.glyphUniforms.atlas, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, glyphData.length / GLYPH_STRIDE);
    }

    // --- Decorations (underline/strikethrough) + cursor: sparse. ---
    const deco: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = this.grid[row * cols + col];
        if (cell.flags & CellFlags.HIDDEN) continue;
        const [r, g, b, a] = unpackRgba(this.resolvedFg(cell));
        if (cell.flags & ALL_UNDERLINE_FLAGS) {
          deco.push(col, row + 0.85, 1, 0.1, r, g, b, a);
        }
        if (cell.flags & CellFlags.STRIKETHROUGH) {
          deco.push(col, row + 0.45, 1, 0.08, r, g, b, a);
        }
      }
    }
    if (this.selection && this.selection.kind !== "search") {
      // Fill is already baked into the background pass above (see
      // `plainSelectionBg`) — only the solid-accent 1px box border is
      // drawn here, on top of the glyphs, the same "-dim fill, solid-accent
      // border" pairing the app uses elsewhere for selected/focused state.
      // Border quads are thin filled rects — WebGL has no native
      // stroke-rect — sized from a target px thickness converted into this
      // pass's cell-unit coordinate space. Top/bottom edges only draw on
      // the selection's actual first/last row, so a multi-line selection
      // reads as one outlined block instead of a line between every row.
      const [br, bg, bb, ba] = this.themeColor("--glyph-accent", "#ff3030");
      const borderPx = 1.5;
      const bx = this.cellWidth > 0 ? borderPx / this.cellWidth : 0;
      const by = this.cellHeight > 0 ? borderPx / this.cellHeight : 0;
      const sel = this.selection;
      const topRow = Math.min(sel.startRow, sel.endRow);
      const bottomRow = Math.max(sel.startRow, sel.endRow);
      for (let row = 0; row < rows; row++) {
        const cols_ = this.selectionColsForRow(row);
        if (!cols_) continue;
        const [fromCol, toCol] = cols_;
        deco.push(fromCol, row, bx, 1, br, bg, bb, ba);
        deco.push(toCol - bx, row, bx, 1, br, bg, bb, ba);
        if (row === topRow) deco.push(fromCol, row, toCol - fromCol, by, br, bg, bb, ba);
        if (row === bottomRow) deco.push(fromCol, row + 1 - by, toCol - fromCol, by, br, bg, bb, ba);
      }
    }
    if (this.cursor.visible && this.cursor.blinkOn) {
      const accent = this.themeColor("--glyph-accent", "#ff3030");
      pushCursorQuad(deco, this.cursor, this.cellWidth, this.cellHeight, accent, this.focused);
    }
    if (deco.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.decoInstanceVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(deco), gl.DYNAMIC_DRAW);

      gl.useProgram(this.solidProgram);
      gl.bindVertexArray(this.decoVao);
      gl.uniform2f(this.solidUniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform2f(this.solidUniforms.cellSize, cellWidth * this.dpr, cellHeight * this.dpr);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, deco.length / SOLID_STRIDE);
    }

    gl.bindVertexArray(null);
  }
}

function unpackRgba(packed: number): [number, number, number, number] {
  const r = ((packed >>> 24) & 0xff) / 255;
  const g = ((packed >>> 16) & 0xff) / 255;
  const b = ((packed >>> 8) & 0xff) / 255;
  const a = (packed & 0xff) / 255;
  return [r, g, b, a];
}

/** Parses a CSS color string — `#rgb`/`#rrggbb` hex or `rgb()`/`rgba()` —
 * into normalized `[r, g, b, a]` floats, the shape the instanced
 * solid-quad pipeline's per-instance color attribute needs. Falls back to
 * the Nothing-red accent if `value` matches neither form (e.g. empty,
 * before any theme has applied its CSS custom properties). */
function parseCssColor(value: string): [number, number, number, number] {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      1,
    ];
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (rgb) {
    return [
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
      rgb[4] !== undefined ? Number(rgb[4]) : 1,
    ];
  }
  return [1, 48 / 255, 48 / 255, 1];
}

function pushCursorQuad(
  out: number[],
  cursor: { col: number; line: number; shape: WireCursorShape },
  cellWidth: number,
  cellHeight: number,
  accent: [number, number, number, number],
  focused: boolean,
) {
  const [r, g, b, a] = accent;
  const { col, line, shape } = cursor;

  if (!focused) {
    // Unfocused pane (e.g. the non-active side of a split): a hollow
    // outline instead of the focused pane's solid fill, so only one pane
    // ever reads as having an "active" cursor. WebGL has no native
    // stroke-rect, so a Block cursor is four thin filled edge quads —
    // the same technique the selection border above uses.
    const dimA = a * 0.55;
    const bx = cellWidth > 0 ? 1 / cellWidth : 0;
    const by = cellHeight > 0 ? 1 / cellHeight : 0;
    switch (shape) {
      case WireCursorShape.Block:
        out.push(col, line, bx, 1, r, g, b, dimA);
        out.push(col + 1 - bx, line, bx, 1, r, g, b, dimA);
        out.push(col, line, 1, by, r, g, b, dimA);
        out.push(col, line + 1 - by, 1, by, r, g, b, dimA);
        break;
      case WireCursorShape.Bar:
        out.push(col, line, 3.5 / cellWidth, 1, r, g, b, dimA);
        break;
      case WireCursorShape.Underline:
        out.push(col, line + 1 - 3.5 / cellHeight, 1, 3.5 / cellHeight, r, g, b, dimA);
        break;
      case WireCursorShape.Hidden:
      default:
        break;
    }
    return;
  }

  switch (shape) {
    case WireCursorShape.Block:
      out.push(col, line, 1, 1, r, g, b, a * 0.85);
      break;
    case WireCursorShape.Bar:
      out.push(col, line, 3.5 / cellWidth, 1, r, g, b, a);
      break;
    case WireCursorShape.Underline:
      out.push(col, line + 1 - 3.5 / cellHeight, 1, 3.5 / cellHeight, r, g, b, a);
      break;
    case WireCursorShape.Hidden:
    default:
      break;
  }
}
