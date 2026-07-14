import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

// Real brands from delivered work (see src/data/projects.ts) — never
// invent client names here.
const ROW_ONE = ['Guestpostbar', 'GainBlockX', 'Grags', 'TZ Wellness Centre', 'DRD Academy'];
const ROW_TWO = ['Big Rafeal', 'Golden Vest', 'Al Fazal Palace', 'Atlas', 'School Portal'];

function BrandName({ name }: { name: string }) {
  return (
    <span className="flex items-center shrink-0">
      <span
        className="font-display font-bold uppercase text-[#52525B] hover:text-[#FAFAFA] transition-colors duration-300 whitespace-nowrap"
        style={{
          fontSize: 'clamp(1.5rem, 3vw, 2.75rem)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {name}
      </span>
      <span
        aria-hidden="true"
        className="bg-[#DFE104] shrink-0"
        style={{
          width: 'clamp(8px, 0.8vw, 12px)',
          height: 'clamp(8px, 0.8vw, 12px)',
          margin: '0 clamp(1.5rem, 3vw, 3.5rem)',
        }}
      />
    </span>
  );
}

function MarqueeRow({ names, reverse, duration }: { names: string[]; reverse?: boolean; duration: number }) {
  const content = (
    <>
      {names.map((n) => (
        <BrandName key={n} name={n} />
      ))}
    </>
  );
  return (
    <div className="flex overflow-hidden" style={{ padding: '1.25rem 0' }}>
      <div
        className="flex animate-marquee whitespace-nowrap"
        style={{
          animationDuration: `${duration}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
      >
        {content}
        {content}
        {content}
        {content}
      </div>
    </div>
  );
}

export default function TrustedBy() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!sectionRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        headingRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: headingRef.current,
            start: 'top 80%',
          },
        }
      );

      gsap.fromTo(
        rowsRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: rowsRef.current,
            start: 'top 85%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      style={{
        padding: 'clamp(5rem, 10vw, 10rem) 0',
      }}
    >
      <h2
        ref={headingRef}
        className="font-display font-bold uppercase text-[#FAFAFA] text-center"
        style={{
          fontSize: 'clamp(2.25rem, 6vw, 5.5rem)',
          lineHeight: 0.9,
          letterSpacing: '-0.02em',
          opacity: 0,
          padding: '0 clamp(1.5rem, 5vw, 6rem)',
        }}
      >
        Brands That <span className="text-[#DFE104]">Build With Us</span>
      </h2>

      <div ref={rowsRef} style={{ marginTop: 'clamp(2.5rem, 4vw, 4rem)', opacity: 0 }}>
        {reducedMotion ? (
          // Static wall for reduced-motion visitors — same names, no scroll.
          <div
            className="flex flex-wrap justify-center"
            style={{
              gap: 'clamp(1rem, 2vw, 2rem) clamp(1.5rem, 3vw, 3.5rem)',
              padding: '0 clamp(1.5rem, 5vw, 6rem)',
            }}
          >
            {[...ROW_ONE, ...ROW_TWO].map((n) => (
              <span
                key={n}
                className="font-display font-bold uppercase text-[#52525B]"
                style={{ fontSize: 'clamp(1.25rem, 2.2vw, 2rem)', letterSpacing: '-0.02em' }}
              >
                {n}
              </span>
            ))}
          </div>
        ) : (
          <div
            style={{
              borderTop: '1px solid #27272A',
              borderBottom: '1px solid #27272A',
            }}
          >
            <MarqueeRow names={ROW_ONE} duration={38} />
            <div style={{ borderTop: '1px solid #27272A' }} />
            <MarqueeRow names={ROW_TWO} reverse duration={46} />
          </div>
        )}
      </div>

      <p
        className="text-[#A1A1AA] text-center mx-auto"
        style={{
          fontSize: 'clamp(1.125rem, 1.5vw, 1.5rem)',
          fontWeight: 400,
          lineHeight: 1.6,
          maxWidth: '48ch',
          marginTop: 'clamp(2rem, 3vw, 3rem)',
          padding: '0 clamp(1.5rem, 5vw, 6rem)',
        }}
      >
        From startups to enterprises — real products, live in production, built
        end-to-end by our team.
      </p>
    </section>
  );
}
