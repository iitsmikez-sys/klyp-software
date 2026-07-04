"use client";

import { useEffect, useRef } from "react";

/** Lightweight 2D-canvas starfield: gently bobbing, twinkling dots. */
export default function Stars({ density = 1 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = window.innerWidth < 768;
    const count = Math.round((isMobile ? 22 : 48) * density);

    type Star = {
      x: number; y: number; r: number;
      phase: number; speed: number; amp: number; green: boolean;
    };
    let stars: Star[] = [];

    const seed = () => {
      stars = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.5,
        amp: 4 + Math.random() * 10,
        green: Math.random() < 0.35,
      }));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    seed();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    const draw = (t: number) => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const bob = Math.sin(t * 0.001 * s.speed + s.phase) * s.amp;
        const drift = Math.cos(t * 0.0007 * s.speed + s.phase) * s.amp * 0.6;
        const alpha = 0.25 + (Math.sin(t * 0.002 * s.speed + s.phase) + 1) * 0.2;
        ctx.beginPath();
        ctx.arc(s.x * w + drift, s.y * h + bob, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.green
          ? `rgba(0,229,160,${alpha})`
          : `rgba(232,232,240,${alpha * 0.7})`;
        ctx.fill();
      }
    };

    if (reducedMotion) {
      draw(0);
    } else {
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (visible && !document.hidden) draw(t);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
