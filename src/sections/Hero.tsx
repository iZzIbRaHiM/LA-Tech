import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

function generateHeroImage(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  // 1. Fill background
  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, 1920, 1080);

  // 2. Grid setup
  const cols = 40;
  const rows = 25;
  const spacingX = 1920 / cols;
  const spacingY = 1080 / rows;

  // 3. Generate nodes
  interface Node {
    x: number;
    y: number;
    r: number;
  }
  const nodes: Node[] = [];

  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (Math.random() < 0.25) {
        const x = i * spacingX + spacingX / 2;
        const y = j * spacingY + spacingY / 2;
        const r = 2 + Math.random() * 4;
        nodes.push({ x, y, r });
      }
    }
  }

  // 4. Draw connections
  const connectionDist = 150;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < connectionDist) {
        const opacity = 0.15 * (1 - dist / connectionDist);
        ctx.strokeStyle = `rgba(223, 225, 4, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }

  // 5. Draw nodes
  for (const node of nodes) {
    ctx.fillStyle = `rgba(223, 225, 4, 0.6)`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Data streams (Catmull-Rom splines)
  function catmullRomToBezier(points: { x: number; y: number }[]): { cp1: { x: number; y: number }; cp2: { x: number; y: number }; end: { x: number; y: number } }[] {
    const result: { cp1: { x: number; y: number }; cp2: { x: number; y: number }; end: { x: number; y: number } }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[Math.min(i + 1, points.length - 1)];
      const p3 = points[Math.min(i + 2, points.length - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      result.push({
        cp1: { x: cp1x, y: cp1y },
        cp2: { x: cp2x, y: cp2y },
        end: { x: p2.x, y: p2.y },
      });
    }
    return result;
  }

  for (let s = 0; s < 10; s++) {
    const numPoints = 4 + Math.floor(Math.random() * 5);
    const points: { x: number; y: number }[] = [];
    for (let p = 0; p < numPoints; p++) {
      points.push({
        x: (p / (numPoints - 1)) * 1920,
        y: Math.random() * 1080,
      });
    }

    const segments = catmullRomToBezier(points);
    ctx.strokeStyle = 'rgba(223, 225, 4, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const seg of segments) {
      ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
    }
    ctx.stroke();

    // Dots along the path
    for (let d = 0; d < 6; d++) {
      const t = d / 5;
      const idx = Math.min(Math.floor(t * segments.length), segments.length - 1);
      const seg = segments[idx];
      const localT = (t * segments.length) - idx;
      const dotX = (1 - localT) * (1 - localT) * (1 - localT) * points[idx].x +
        3 * (1 - localT) * (1 - localT) * localT * seg.cp1.x +
        3 * (1 - localT) * localT * localT * seg.cp2.x +
        localT * localT * localT * seg.end.x;
      const dotY = (1 - localT) * (1 - localT) * (1 - localT) * points[idx].y +
        3 * (1 - localT) * (1 - localT) * localT * seg.cp1.y +
        3 * (1 - localT) * localT * localT * seg.cp2.y +
        localT * localT * localT * seg.end.y;
      ctx.fillStyle = 'rgba(223, 225, 4, 0.5)';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas.toDataURL('image/png');
}

export default function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const title1Ref = useRef<HTMLDivElement>(null);
  const title2Ref = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const [heroImage, setHeroImage] = useState<string>('');
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // Generate the hero image
    const img = generateHeroImage();
    setHeroImage(img);
  }, []);

  useEffect(() => {
    if (!heroImage || !containerRef.current || !imgRef.current) return;

    const ctx = gsap.context(() => {
      // Entrance animations
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo(
        title1Ref.current,
        { opacity: 0, y: 80 },
        { opacity: 1, y: 0, duration: 1 }
      )
        .fromTo(
          title2Ref.current,
          { opacity: 0, y: 80 },
          { opacity: 1, y: 0, duration: 1 },
          '-=0.8'
        )
        .fromTo(
          subtitleRef.current,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.8 },
          '-=0.4'
        )
        .fromTo(
          ctaRef.current,
          { opacity: 0, y: 40 },
          { opacity: 1, y: 0, duration: 0.8 },
          '-=0.4'
        );

      if (!reducedMotion) {
        // Parallax scale on scroll
        const st1 = ScrollTrigger.create({
          trigger: containerRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          animation: gsap.to(imgRef.current, {
            scale: 1.3,
            ease: 'none',
          }),
        });

        // Fade out on scroll
        const st2 = ScrollTrigger.create({
          trigger: containerRef.current,
          start: 'top top',
          end: '50% top',
          scrub: true,
          animation: gsap.to(imgRef.current, {
            opacity: 0,
            ease: 'none',
          }),
        });

        return () => {
          st1.kill();
          st2.kill();
        };
      }
    }, containerRef);

    return () => ctx.revert();
  }, [heroImage, reducedMotion]);

  const handleCtaClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.querySelector('#contact');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section
      ref={containerRef}
      className="relative overflow-hidden"
      style={{ height: '100vh' }}
    >
      {/* Procedural Background Image */}
      {heroImage && (
        <img
          ref={imgRef}
          src={heroImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{
            filter: 'grayscale(100%) contrast(120%)',
            mixBlendMode: 'overlay',
          }}
        />
      )}

      {/* Dark Overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: '#09090B', opacity: 0.6 }}
      />

      {/* Content */}
      <div
        className="relative z-10 flex flex-col justify-between h-full"
        style={{ padding: 'clamp(1.5rem, 5vw, 6rem)' }}
      >
        {/* Top Spacer for Nav */}
        <div style={{ height: '72px' }} />

        {/* Title Row 1 */}
        <div
          ref={title1Ref}
          className="font-display font-bold uppercase text-[#FAFAFA]"
          style={{
            fontSize: 'clamp(3rem, 14vw, 16rem)',
            letterSpacing: '-0.02em',
            lineHeight: 0.85,
            opacity: 0,
          }}
        >
          LATech
        </div>

        {/* Title Row 2 */}
        <div
          ref={title2Ref}
          className="font-display font-bold uppercase text-[#FAFAFA] text-right"
          style={{
            fontSize: 'clamp(3rem, 14vw, 16rem)',
            letterSpacing: '-0.02em',
            lineHeight: 0.85,
            opacity: 0,
          }}
        >
          Solutions
        </div>

        {/* Bottom Content */}
        <div className="pb-8">
          <p
            ref={subtitleRef}
            className="text-[#A1A1AA]"
            style={{
              fontSize: 'clamp(1.125rem, 1.5vw, 1.5rem)',
              fontWeight: 400,
              lineHeight: 1.5,
              maxWidth: '42ch',
              opacity: 0,
            }}
          >
            We engineer high-performance systems and enterprise software built to scale.
          </p>

          <a
            ref={ctaRef}
            href="#contact"
            onClick={handleCtaClick}
            className="inline-flex items-center justify-center font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200 mt-8"
            style={{
              height: '56px',
              padding: '0 2rem',
              fontSize: 'clamp(0.875rem, 1.2vw, 1.25rem)',
              letterSpacing: '-0.02em',
              borderRadius: '0',
              opacity: 0,
            }}
          >
            Start a Project
          </a>

          {/* Scroll Indicator */}
          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 font-display uppercase text-[#A1A1AA] animate-pulse-opacity"
            style={{
              fontSize: 'clamp(0.75rem, 1vw, 1rem)',
              letterSpacing: '0.05em',
            }}
          >
            SCROLL ↓
          </div>
        </div>
      </div>
    </section>
  );
}
