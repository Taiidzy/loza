import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  o: number; // opacity
}

const PARTICLE_COUNT = 55;
const LINK_DISTANCE = 90; // максимальное расстояние, при котором рисуется соединяющая линия

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.6 + 0.4,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    o: Math.random() * 0.4 + 0.1,
  }));
}

/**
 * Декоративный анимированный фон: плавающие частицы, соединяющиеся линиями,
 * когда оказываются рядом друг с другом ("constellation" эффект).
 * Рисуется на <canvas> напрямую — для десятков частиц с линиями это
 * значительно дешевле, чем эквивалент через DOM/SVG.
 */
export default function ParticlesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = createParticles(canvas.width, canvas.height);

    let animationFrame: number;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Двигаем частицы и рисуем сами точки, заворачивая их по краям канваса
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 182, 210, ${p.o})`;
        ctx.fill();
      }

      // Соединяем близко расположенные частицы линиями, затухающими с расстоянием
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < LINK_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(200, 160, 255, ${0.12 * (1 - distance / LINK_DISTANCE)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animationFrame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
