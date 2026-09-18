/**
 * Rasterizes glyphs once into a shared WebGL2 texture, tracked by
 * (character, bold, italic) key. Each glyph is drawn WHITE on a
 * transparent background, so the alpha channel alone is the glyph's
 * coverage mask — the renderer tints it to the cell's actual foreground
 * color in the fragment shader, which means one atlas slot serves every
 * color a character is ever drawn in, instead of needing one per
 * (char, color) pair.
 *
 * Packing is a simple fixed-height shelf packer: glyphs are placed left
 * to right, wrapping to a new row when a row fills up. This is not
 * space-optimal for proportional-width edge cases, but every slot here is
 * a fixed 1-or-2-cell-wide box (monospace + wide chars), so shelf packing
 * wastes almost nothing in practice.
 */

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Slot width in cells: 1 for normal glyphs, 2 for wide (CJK/emoji). */
  cellSpan: 1 | 2;
}

const ATLAS_SIZE = 2048;

export class GlyphAtlas {
  readonly texture: WebGLTexture;
  private gl: WebGL2RenderingContext;
  private raster: HTMLCanvasElement;
  private rasterCtx: CanvasRenderingContext2D;
  private cellWidth: number;
  private cellHeight: number;
  private fontFamily: string;
  private fontSize: number;

  private cache = new Map<string, AtlasRect>();
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight = 0;
  private full = false;

  constructor(
    gl: WebGL2RenderingContext,
    opts: { fontFamily: string; fontSize: number; cellWidth: number; cellHeight: number },
  ) {
    this.gl = gl;
    this.fontFamily = opts.fontFamily;
    this.fontSize = opts.fontSize;
    this.cellWidth = opts.cellWidth;
    this.cellHeight = opts.cellHeight;

    this.raster = document.createElement("canvas");
    this.raster.width = opts.cellWidth * 2;
    this.raster.height = opts.cellHeight;
    const ctx = this.raster.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable for glyph rasterization");
    this.rasterCtx = ctx;

    const texture = gl.createTexture();
    if (!texture) throw new Error("failed to create atlas texture");
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      ATLAS_SIZE,
      ATLAS_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Returns the atlas UV rect for this glyph, rasterizing + uploading it
   * on first use. Returns `null` if the atlas is full (extremely unlikely
   * for one terminal session's character set — logged once and the caller
   * should skip drawing that glyph rather than crash). */
  getRect(text: string, bold: boolean, italic: boolean, wide: boolean): AtlasRect | null {
    const key = `${text}|${bold ? 1 : 0}|${italic ? 1 : 0}|${wide ? 1 : 0}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.rasterize(key, text, bold, italic, wide);
  }

  private rasterize(key: string, text: string, bold: boolean, italic: boolean, wide: boolean): AtlasRect | null {
    const span: 1 | 2 = wide ? 2 : 1;
    const slotWidth = this.cellWidth * span;
    const slotHeight = this.cellHeight;

    if (this.cursorX + slotWidth > ATLAS_SIZE) {
      this.cursorX = 0;
      this.cursorY += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.cursorY + slotHeight > ATLAS_SIZE) {
      if (!this.full) {
        console.warn("[GlyphAtlas] atlas full — further glyphs will not be drawn");
        this.full = true;
      }
      return null;
    }

    // Resizing the canvas clears it and resets 2D context state, which is
    // exactly what we want here: texSubImage2D below reads this canvas's
    // *entire* current size as the source, so it must be exactly
    // slotWidth x slotHeight — never the (possibly larger, for a 1-wide
    // glyph after a wide one) previous size — or it'll stomp neighboring
    // atlas slots.
    this.raster.width = slotWidth;
    this.raster.height = slotHeight;
    const ctx = this.rasterCtx;
    ctx.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    const baseline = Math.round(slotHeight * 0.78);
    ctx.fillText(text, 0, baseline);

    // Canvas-source texSubImage2D takes no explicit width/height — the
    // source canvas's own dimensions are used, which is why `raster` is
    // sized to exactly slotWidth x slotHeight before drawing into it.
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      this.cursorX,
      this.cursorY,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.raster,
    );

    const rect: AtlasRect = {
      u0: this.cursorX / ATLAS_SIZE,
      v0: this.cursorY / ATLAS_SIZE,
      u1: (this.cursorX + slotWidth) / ATLAS_SIZE,
      v1: (this.cursorY + slotHeight) / ATLAS_SIZE,
      cellSpan: span,
    };
    this.cache.set(key, rect);

    this.cursorX += slotWidth;
    this.rowHeight = Math.max(this.rowHeight, slotHeight);

    return rect;
  }

  dispose() {
    this.gl.deleteTexture(this.texture);
  }
}
