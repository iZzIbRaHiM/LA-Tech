import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);


const steps = [
  {
    number: '01',
    title: 'Discover',
    description: 'We dive deep into your operations, interviewing stakeholders and mapping workflows to identify transformation opportunities.',
  },
  {
    number: '02',
    title: 'Design',
    description: 'Our architects design systems that scale — choosing the right tech stack, data models, and user flows for your needs.',
  },
  {
    number: '03',
    title: 'Develop',
    description: 'Agile sprints with weekly demos. You see progress in real-time, not at a final handoff.',
  },
  {
    number: '04',
    title: 'Deploy & Support',
    description: 'Launch is just the beginning. We monitor, optimize, and provide ongoing support to keep your systems running.',
  },
];

export default function Process() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!sectionRef.current || !headingRef.current || !stepsRef.current) return;

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

      // Steps entrance animations
      const stepEls = stepsRef.current!.querySelectorAll('.process-step');
      stepEls.forEach((step, i) => {
        const content = step.querySelector('.step-content');
        const bgNumber = step.querySelector('.bg-number');
        const fromX = i % 2 === 0 ? -80 : 80;

        if (content) {
          gsap.fromTo(
            content,
            { 
              opacity: 0, 
              x: isMobile ? 0 : fromX,
              y: isMobile ? 40 : 0
            },
            {
              opacity: 1,
              x: 0,
              y: 0,
              duration: 1,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: step,
                start: 'top 75%',
              },
            }
          );
        }

        if (bgNumber) {
          gsap.fromTo(
            bgNumber,
            { opacity: 0 },
            {
              opacity: 0.5,
              duration: 1.5,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: step,
                start: 'top 75%',
              },
            }
          );
        }
      });
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      id="process"
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
        How We Work
      </h2>

      <div ref={stepsRef} className="flex flex-col">
        {steps.map((step, i) => (
          <div
            key={i}
            className="process-step relative"
            style={{
              padding: 'clamp(2rem, 3vw, 4rem) 0',
              borderBottom: '1px solid #3F3F46',
            }}
          >
            {/* Background Number */}
            <div
              className="bg-number absolute font-display font-bold text-[#27272A] pointer-events-none select-none"
              style={{
                fontSize: 'clamp(6rem, 12vw, 14rem)',
                lineHeight: 0.85,
                letterSpacing: '-0.02em',
                opacity: 0,
                zIndex: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                right: i % 2 === 0 ? '0' : 'auto',
                left: i % 2 === 0 ? 'auto' : '0',
              }}
              aria-hidden="true"
            >
              {step.number}
            </div>

            {/* Step Content */}
            <div
              className="step-content relative z-10"
              style={{
                maxWidth: isMobile ? '100%' : '60%',
                marginLeft: isMobile ? '0' : (i % 2 === 0 ? '0' : 'auto'),
                opacity: 0,
              }}
            >
              <span
                className="font-display font-bold uppercase text-[#DFE104]"
                style={{
                  fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                  letterSpacing: '0.05em',
                }}
              >
                {step.number}
              </span>
              <h3
                className="font-display font-bold uppercase text-[#FAFAFA] mt-2"
                style={{
                  fontSize: 'clamp(1.5rem, 4vw, 4rem)',
                  lineHeight: 0.85,
                  letterSpacing: '-0.02em',
                }}
              >
                {step.title}
              </h3>
              <p
                className="text-[#A1A1AA] mt-4"
                style={{
                  fontSize: 'clamp(1rem, 1.2vw, 1.25rem)',
                  fontWeight: 400,
                  lineHeight: 1.5,
                  maxWidth: '42ch',
                }}
              >
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
