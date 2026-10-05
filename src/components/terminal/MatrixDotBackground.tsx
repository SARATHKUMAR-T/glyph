import { useEffect, useRef } from "react";
import type { MatrixSpeed, MatrixStyle } from "../../hooks/useTerminalSettings";

type MatrixDotBackgroundProps = {
  style?: MatrixStyle;
  speed?: MatrixSpeed;
  interactive?: boolean;
  opacity?: number;
  dotColor?: string;
  enabled?: boolean;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace("#", "").trim();
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split("").map((c) => c + c).join("");
  }
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) return { r: 140, g: 140, b: 145 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

const SPACING = 20;
const MOUSE_RADIUS = 130;
/** The animated styles are slow ambient motion; 30fps is indistinguishable
 * from 60 there and halves the full-window repaint + recomposite cost that
 * every terminal canvas above this layer has to share a frame with. */
const ANIMATION_FRAME_MS = 1000 / 30;
const ALPHA_STEPS = 32;

/**
 * Full-window dot-matrix backdrop. This sits under every terminal pane, so
 * anything it repaints forces the whole window to recomposite — it is kept as
 * cheap as possible:
 *
 * - `static-grid` is painted once into an offscreen layer and only touched
 *   again when the pointer moves (and then only around the pointer); there is
 *   no animation loop at all while idle.
 * - The animated styles run at 30fps, are delta-time driven (so the cap does
 *   not slow the motion down), stop while the window is hidden, and blit
 *   pre-rendered dot sprites instead of building and filling a path (with a
 *   `shadowBlur`) per dot.
 */
export function MatrixDotBackground({
  style = "static-grid",
  speed = "normal",
  interactive = true,
  opacity = 0.45,
  dotColor = "#8c8c91",
  enabled = true,
}: MatrixDotBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { r, g, b } = hexToRgb(dotColor);
    const mouse = { x: -1000, y: -1000, active: false };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastFrameAt = 0;
    let disposed = false;

    // --- Dot sprites -----------------------------------------------------
    // Keyed by quantized (radius, alpha). Rendered at device resolution and
    // drawn at CSS size so they stay crisp on HiDPI screens.
    const sprites = new Map<number, { canvas: HTMLCanvasElement; size: number }>();
    const getDot = (radius: number, alpha: number) => {
      const rKey = Math.max(1, Math.round(radius * 4));
      const aKey = Math.max(1, Math.min(ALPHA_STEPS, Math.round(alpha * ALPHA_STEPS)));
      const key = rKey * 1000 + aKey;
      let sprite = sprites.get(key);
      if (!sprite) {
        const rad = rKey / 4;
        const size = Math.ceil(rad * 2 + 2);
        const el = document.createElement("canvas");
        el.width = Math.ceil(size * dpr);
        el.height = Math.ceil(size * dpr);
        const sctx = el.getContext("2d");
        if (sctx) {
          sctx.scale(dpr, dpr);
          sctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${aKey / ALPHA_STEPS})`;
          sctx.beginPath();
          sctx.arc(size / 2, size / 2, rad, 0, Math.PI * 2);
          sctx.fill();
        }
        sprite = { canvas: el, size };
        sprites.set(key, sprite);
      }
      return sprite;
    };
    const drawDot = (px: number, py: number, radius: number, alpha: number) => {
      if (alpha <= 0) return;
      const { canvas: el, size } = getDot(radius, alpha);
      ctx.drawImage(el, px - size / 2, py - size / 2, size, size);
    };
    /** Soft halo standing in for the old per-dot `shadowBlur`. */
    const drawGlow = (px: number, py: number, radius: number, strength: number) => {
      drawDot(px, py, radius * 2.4, 0.18 * strength);
    };

    // --- static-grid -----------------------------------------------------
    let baseLayer: HTMLCanvasElement | null = null;

    const staticDot = (px: number, py: number, proximity: number) => {
      const alpha = Math.min(1, (0.22 + proximity * 0.45) * opacity);
      const radius = 1.2 + proximity * 1.2;
      if (proximity > 0.4) drawGlow(px, py, radius, proximity);
      drawDot(px, py, radius, alpha);
    };

    const buildBaseLayer = () => {
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const lctx = layer.getContext("2d");
      if (!lctx) return null;
      const { canvas: dot, size } = getDot(1.2, Math.min(1, 0.22 * opacity));
      lctx.scale(dpr, dpr);
      const cols = Math.ceil(width / SPACING);
      const rows = Math.ceil(height / SPACING);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          lctx.drawImage(
            dot,
            col * SPACING + SPACING / 2 - size / 2,
            row * SPACING + SPACING / 2 - size / 2,
            size,
            size,
          );
        }
      }
      return layer;
    };

    const renderStatic = () => {
      ctx.clearRect(0, 0, width, height);
      if (baseLayer) ctx.drawImage(baseLayer, 0, 0, width, height);
      if (!(interactive && mouse.active)) return;

      // Repaint only the cells the pointer influences, over a cleared patch,
      // so the result matches the per-dot formula exactly.
      const reach = MOUSE_RADIUS + SPACING;
      const x0 = Math.max(0, mouse.x - reach);
      const y0 = Math.max(0, mouse.y - reach);
      const x1 = Math.min(width, mouse.x + reach);
      const y1 = Math.min(height, mouse.y + reach);
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      const cMin = Math.max(0, Math.floor(x0 / SPACING));
      const cMax = Math.min(Math.ceil(width / SPACING) - 1, Math.ceil(x1 / SPACING));
      const rMin = Math.max(0, Math.floor(y0 / SPACING));
      const rMax = Math.min(Math.ceil(height / SPACING) - 1, Math.ceil(y1 / SPACING));
      for (let row = rMin; row <= rMax; row++) {
        for (let col = cMin; col <= cMax; col++) {
          const px = col * SPACING + SPACING / 2;
          const py = row * SPACING + SPACING / 2;
          if (px < x0 || px > x1 || py < y0 || py > y1) continue;
          const dist = Math.hypot(px - mouse.x, py - mouse.y);
          staticDot(px, py, Math.max(0, 1 - dist / MOUSE_RADIUS));
        }
      }
    };

    // --- animated styles ---------------------------------------------------
    const speedMultiplier = speed === "slow" ? 0.6 : speed === "fast" ? 1.6 : 1.0;

    type RainColumn = { x: number; y: number; speed: number; length: number };
    const rainCols: RainColumn[] = [];
    const initRain = () => {
      rainCols.length = 0;
      const count = Math.min(120, Math.ceil(width / SPACING) + 1);
      for (let c = 0; c < count; c++) {
        rainCols.push({
          x: c * SPACING + SPACING / 2,
          y: Math.random() * -height,
          speed: (2 + Math.random() * 3) * speedMultiplier,
          length: 8 + Math.floor(Math.random() * 16),
        });
      }
    };

    const mouseGlowAt = (px: number, py: number, falloff: number) => {
      if (!(interactive && mouse.active)) return 0;
      const dx = px - mouse.x;
      const dy = py - mouse.y;
      // Cheap reject before the sqrt.
      if (dx > falloff || dx < -falloff || dy > falloff || dy < -falloff) return 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < falloff ? 1 - dist / falloff : 0;
    };

    const renderRain = (frameScale: number) => {
      ctx.clearRect(0, 0, width, height);
      const rows = Math.ceil(height / SPACING);

      for (const col of rainCols) {
        col.y += col.speed * frameScale;

        if (col.y - col.length * SPACING > height) {
          col.y = Math.random() * -100;
          col.speed = (2 + Math.random() * 3) * speedMultiplier;
          col.length = 8 + Math.floor(Math.random() * 16);
        }

        const headRow = Math.floor(col.y / SPACING);
        for (let j = 0; j < col.length; j++) {
          const row = headRow - j;
          if (row < 0 || row > rows) continue;

          const py = row * SPACING + SPACING / 2;
          const px = col.x;
          const mouseGlow = mouseGlowAt(px, py, MOUSE_RADIUS);

          const fadeRatio = 1 - j / col.length;
          const alpha = Math.min(1, Math.max(0, fadeRatio * 0.4 * opacity + mouseGlow * 0.35));
          const radius = Math.max(1.0, 1.5 * fadeRatio + mouseGlow * 1.2);

          if (j === 0 || mouseGlow > 0.5) drawGlow(px, py, radius, 1);
          drawDot(px, py, radius, alpha);
        }
      }
    };

    let waveTime = 0;
    const renderRipple = (frameScale: number) => {
      waveTime += 0.03 * speedMultiplier * frameScale;
      ctx.clearRect(0, 0, width, height);
      const cols = Math.ceil(width / SPACING);
      const rows = Math.ceil(height / SPACING);

      for (let row = 0; row < rows; row++) {
        const py = row * SPACING + SPACING / 2;
        const cy = py - height / 2;
        for (let col = 0; col < cols; col++) {
          const px = col * SPACING + SPACING / 2;
          const cx = px - width / 2;
          const wave = Math.sin(Math.sqrt(cx * cx + cy * cy) * 0.012 - waveTime);
          const proximity = mouseGlowAt(px, py, 140);
          const alpha = Math.min(1, Math.max(0, (0.18 + wave * 0.08 + proximity * 0.35) * opacity));
          drawDot(px, py, 1.2 + proximity * 1.2, alpha);
        }
      }
    };

    // --- sizing ------------------------------------------------------------
    const applySize = () => {
      const nextDpr = window.devicePixelRatio || 1;
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      if (nextW === width && nextH === height && nextDpr === dpr) return;
      if (nextDpr !== dpr) sprites.clear();
      width = nextW;
      height = nextH;
      dpr = nextDpr;
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Assigning canvas.width resets the transform; this is not cumulative.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (style === "static-grid") baseLayer = buildBaseLayer();
      if (style === "matrix-rain") initRain();
      requestRender();
    };

    // --- scheduling --------------------------------------------------------
    const animated = style !== "static-grid";

    const frame = (now: number) => {
      rafId = 0;
      if (disposed) return;
      if (animated) {
        if (!document.hidden) {
          const elapsed = lastFrameAt === 0 ? ANIMATION_FRAME_MS : now - lastFrameAt;
          if (elapsed >= ANIMATION_FRAME_MS - 1) {
            lastFrameAt = now;
            const frameScale = Math.min(4, elapsed / (1000 / 60));
            if (style === "matrix-rain") renderRain(frameScale);
            else renderRipple(frameScale);
          }
        }
        rafId = requestAnimationFrame(frame);
      } else {
        renderStatic();
      }
    };

    function requestRender() {
      if (rafId === 0 && !disposed && (!animated || !document.hidden)) {
        rafId = requestAnimationFrame(frame);
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      if (!animated) requestRender();
    };
    const handleMouseLeave = () => {
      mouse.active = false;
      if (!animated) requestRender();
    };
    const handleVisibility = () => {
      lastFrameAt = 0;
      if (!document.hidden) requestRender();
    };

    applySize();
    window.addEventListener("resize", applySize);
    document.addEventListener("visibilitychange", handleVisibility);
    if (interactive) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("mouseleave", handleMouseLeave);
    }
    requestRender();

    return () => {
      disposed = true;
      if (rafId !== 0) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", applySize);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [dotColor, enabled, interactive, opacity, speed, style]);

  if (!enabled) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="matrix-dot-background"
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 1,
        opacity: opacity,
      }}
    />
  );
}
