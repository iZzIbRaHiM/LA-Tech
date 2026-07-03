import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import HeroScene from './HeroScene';

gsap.registerPlugin(ScrollTrigger);

export default function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneWrapRef = useRef<HTMLDivElement>(null);
  const title1Ref = useRef<HTMLDivElement>(null);
  const title2Ref = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!containerRef.current || !sceneWrapRef.current) return;

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
          animation: gsap.to(sceneWrapRef.current, {
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
          animation: gsap.to(sceneWrapRef.current, {
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
  }, [reducedMotion]);

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
      {/* Radial glow backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 45%, rgba(223,225,4,0.08) 0%, rgba(9,9,11,0) 70%)',
        }}
      />

      {/* 3D Particle Network (static image for reduced-motion visitors) */}
      <div
        ref={sceneWrapRef}
        className="absolute inset-0 pointer-events-none"
      >
        {reducedMotion ? (
          <img
            src="/images/hero-network-fallback.png"
            alt=""
            className="w-full h-full object-cover"
            style={{ opacity: 0.55 }}
          />
        ) : (
          <HeroScene />
        )}
      </div>

      {/* Dark Overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: '#09090B', opacity: 0.35 }}
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
