import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

const services = [
  {
    title: 'Custom Software Solutions',
    description: 'Tailored applications for schools, hospitals, and enterprises. Built to fit your exact workflow.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="8" y="8" width="32" height="32" />
        <line x1="8" y1="20" x2="40" y2="20" />
        <line x1="20" y1="20" x2="20" y2="40" />
      </svg>
    ),
  },
  {
    title: 'Business Process Automation',
    description: 'Replace manual work with intelligent systems. Faster operations, fewer errors.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="14" cy="24" r="8" />
        <circle cx="34" cy="24" r="8" />
        <line x1="22" y1="24" x2="26" y2="24" />
      </svg>
    ),
  },
  {
    title: 'Digital Transformation',
    description: 'Modernize legacy systems, migrate to the cloud, and unlock new operational capabilities.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 36 L24 12 L40 36" />
        <line x1="24" y1="12" x2="24" y2="36" />
      </svg>
    ),
  },
  {
    title: 'Enterprise Software',
    description: 'HR portals, inventory systems, finance dashboards — internal tools that scale.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="6" y="6" width="36" height="36" />
        <line x1="6" y1="16" x2="42" y2="16" />
        <line x1="6" y1="32" x2="42" y2="32" />
        <line x1="16" y1="16" x2="16" y2="42" />
        <line x1="32" y1="16" x2="32" y2="42" />
      </svg>
    ),
  },
  {
    title: 'SaaS Development',
    description: 'From concept to recurring revenue. We build subscription platforms and cloud-native products.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="8" y="12" width="32" height="24" />
        <line x1="8" y1="18" x2="40" y2="18" />
        <circle cx="14" cy="15" r="1" fill="currentColor" />
        <circle cx="20" cy="15" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: 'IT Solutions & Support',
    description: 'Networking, cloud infrastructure, security, and ongoing technical support.',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="24" cy="18" r="10" />
        <path d="M10 42 Q24 30 38 42" />
      </svg>
    ),
  },
];

export default function Services() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!sectionRef.current || !headingRef.current || !cardsRef.current) return;

    const ctx = gsap.context(() => {
      // Heading entrance
      gsap.fromTo(
        headingRef.current,
        { opacity: 0, y: 60 },
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

      // Cards stagger entrance
      const cards = cardsRef.current!.querySelectorAll('.service-card');
      gsap.fromTo(
        cards,
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.1,
          scrollTrigger: {
            trigger: cardsRef.current,
            start: 'top 80%',
          },
        }
      );
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      id="services"
      style={{
        padding: 'clamp(5rem, 10vw, 10rem) clamp(1.5rem, 5vw, 6rem)',
      }}
    >
      <h2
        ref={headingRef}
        className="font-display font-bold uppercase text-[#FAFAFA]"
        style={{
          fontSize: 'clamp(2.5rem, 8vw, 8rem)',
          lineHeight: 0.85,
          letterSpacing: '-0.02em',
          marginBottom: '4rem',
          opacity: 0,
        }}
      >
        What We Build
      </h2>

      <div
        ref={cardsRef}
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: '2px', backgroundColor: '#3F3F46' }}
      >
        {services.map((service, i) => (
          <div
            key={i}
            className="service-card group bg-[#09090B] border-2 border-[#3F3F46] hover:bg-[#DFE104] hover:border-[#DFE104] transition-all duration-300 cursor-default"
            style={{ padding: 'clamp(2rem, 3vw, 4rem)' }}
          >
            <div className="text-[#FAFAFA] group-hover:text-[#000000] transition-colors duration-300 mb-6">
              {service.icon}
            </div>
            <h3
              className="font-display font-bold uppercase text-[#FAFAFA] group-hover:text-[#000000] transition-colors duration-300 mb-4"
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 4rem)',
                lineHeight: 0.85,
                letterSpacing: '-0.02em',
              }}
            >
              {service.title}
            </h3>
            <p
              className="text-[#A1A1AA] group-hover:text-[#000000] group-hover:opacity-70 transition-colors duration-300"
              style={{
                fontSize: 'clamp(1rem, 1.2vw, 1.25rem)',
                fontWeight: 400,
                lineHeight: 1.5,
                maxWidth: '32ch',
              }}
            >
              {service.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
