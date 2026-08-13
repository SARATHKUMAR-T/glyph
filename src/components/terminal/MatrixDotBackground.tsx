import { useEffect, useRef } from "react";
import type { MatrixSpeed, MatrixStyle } from "../../hooks/useTerminalSettings";

type MatrixDotBackgroundProps = {
  style?: MatrixStyle;
  speed?: MatrixSpeed;
  interactive?: boolean;
  opacity?: number;
  dotColor?: string;
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

export function MatrixDotBackground({
  style = "static-grid",
  speed = "normal",
  interactive = true,
  opacity = 0.45,
  dotColor = "#8c8c91",
}: MatrixDotBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -1000,
    y: -1000,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.active = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    if (interactive) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseleave", handleMouseLeave);
    }

    const spacing = 20;
    let columns = Math.ceil(width / spacing);
    let rows = Math.ceil(height / spacing);

    type RainColumn = {
      x: number;
      y: number;
      speed: number;
      length: number;
    };

    const speedMultiplier = speed === "slow" ? 0.6 : speed === "fast" ? 1.6 : 1.0;

    const rainCols: RainColumn[] = [];
    for (let c = 0; c < 120; c++) {
      rainCols.push({
        x: c * spacing + spacing / 2,
        y: Math.random() * -height,
        speed: (2 + Math.random() * 3) * speedMultiplier,
        length: 8 + Math.floor(Math.random() * 16),
      });
    }

    let waveTime = 0;
    const { r, g, b } = hexToRgb(dotColor);

    const renderFrame = () => {
      ctx.clearRect(0, 0, width, height);

      columns = Math.ceil(width / spacing);
      rows = Math.ceil(height / spacing);
      const mouse = mouseRef.current;

      if (style === "static-grid") {
        // Elegant static dot matrix with custom color support
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          for (let cIdx = 0; cIdx < columns; cIdx++) {
            const px = cIdx * spacing + spacing / 2;
            const py = rIdx * spacing + spacing / 2;

            let mouseDist = 9999;
            if (interactive && mouse.active) {
              const mdx = px - mouse.x;
              const mdy = py - mouse.y;
              mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
            }

            const mouseProximity = Math.max(0, 1 - mouseDist / 130);

            const alpha = Math.min(1, (0.22 + mouseProximity * 0.45) * opacity);
            const radius = 1.2 + mouseProximity * 1.2;

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);

            if (mouseProximity > 0.4) {
              ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
              ctx.shadowBlur = 6 * mouseProximity;
              ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.fill();
            }
          }
        }
      } else if (style === "matrix-rain") {
        // Digital Rain in user selected color
        for (let i = 0; i < rainCols.length; i++) {
          const col = rainCols[i];
          if (!col) continue;

          col.y += col.speed;

          if (col.y - col.length * spacing > height) {
            col.y = Math.random() * -100;
            col.speed = (2 + Math.random() * 3) * speedMultiplier;
            col.length = 8 + Math.floor(Math.random() * 16);
          }

          const headRow = Math.floor(col.y / spacing);

          for (let j = 0; j < col.length; j++) {
            const row = headRow - j;
            if (row < 0 || row > rows) continue;

            const py = row * spacing + spacing / 2;
            const px = col.x;

            let mouseGlow = 0;
            if (interactive && mouse.active) {
              const mdx = px - mouse.x;
              const mdy = py - mouse.y;
              const dist = Math.sqrt(mdx * mdx + mdy * mdy);
              if (dist < 130) {
                mouseGlow = 1 - dist / 130;
              }
            }

            const fadeRatio = 1 - j / col.length;
            const alpha = Math.max(0, fadeRatio * 0.4 * opacity + mouseGlow * 0.35);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
            const dotRadius = Math.max(1.0, 1.5 * fadeRatio + mouseGlow * 1.2);
            ctx.beginPath();
            ctx.arc(px, py, dotRadius, 0, Math.PI * 2);

            if (j === 0 || mouseGlow > 0.5) {
              ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
              ctx.shadowBlur = 6;
              ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.fill();
            }
          }
        }
      } else {
        // Nothing OS Grid ripple mode
        waveTime += 0.03 * speedMultiplier;
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          for (let cIdx = 0; cIdx < columns; cIdx++) {
            const px = cIdx * spacing + spacing / 2;
            const py = rIdx * spacing + spacing / 2;

            const cx = px - width / 2;
            const cy = py - height / 2;
            const distCenter = Math.sqrt(cx * cx + cy * cy);
            const wave = Math.sin(distCenter * 0.012 - waveTime);

            let mouseDist = 9999;
            if (interactive && mouse.active) {
              const mdx = px - mouse.x;
              const mdy = py - mouse.y;
              mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
            }

            const mouseProximity = Math.max(0, 1 - mouseDist / 140);
            const baseAlpha = (0.18 + wave * 0.08 + mouseProximity * 0.35) * opacity;
            const radius = 1.2 + mouseProximity * 1.2;

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, baseAlpha))})`;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const loop = () => {
      renderFrame();
      animFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [dotColor, interactive, opacity, speed, style]);

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
