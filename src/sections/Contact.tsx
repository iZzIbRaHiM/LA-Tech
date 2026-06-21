import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

export default function Contact() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subtextRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
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
        subtextRef.current,
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: subtextRef.current,
            start: 'top 80%',
          },
        }
      );

      const fields = formRef.current?.querySelectorAll('.form-field');
      if (fields) {
        gsap.fromTo(
          fields,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: 'power3.out',
            stagger: 0.1,
            scrollTrigger: {
              trigger: formRef.current,
              start: 'top 80%',
            },
          }
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, [reducedMotion]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(false);
    try {
      const response = await fetch('https://formspree.io/f/maqgwkaa', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
        body: new FormData(e.currentTarget),
      });
      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(true);
      }
    } catch (err) {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      ref={sectionRef}
      id="contact"
      className="bg-[#DFE104]"
      style={{
        padding: 'clamp(5rem, 10vw, 10rem) clamp(1.5rem, 5vw, 6rem)',
      }}
    >
      <div className="max-w-[640px] mx-auto text-center">
        <h2
          ref={headingRef}
          className="font-display font-bold uppercase text-[#000000]"
          style={{
            fontSize: 'clamp(2.5rem, 8vw, 8rem)',
            lineHeight: 0.85,
            letterSpacing: '-0.02em',
            opacity: 0,
          }}
        >
          Ready to Transform?
        </h2>

        <p
          ref={subtextRef}
          className="text-[#000000] mx-auto"
          style={{
            fontSize: 'clamp(1.125rem, 1.5vw, 1.5rem)',
            fontWeight: 400,
            lineHeight: 1.5,
            maxWidth: '48ch',
            marginTop: '1.5rem',
            opacity: 0.7,
          }}
        >
          Tell us about your project. We&apos;ll respond within 24 hours.
        </p>

        {submitted ? (
          <div
            className="mt-12 font-display font-bold uppercase text-[#000000]"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 4rem)',
              lineHeight: 0.85,
              letterSpacing: '-0.02em',
            }}
          >
            Message Sent! We&apos;ll Be in Touch.
          </div>
        ) : (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="flex flex-col mt-12"
            style={{ gap: '2rem' }}
          >
            <div className="form-field" style={{ opacity: 0 }}>
              <input
                type="text"
                name="name"
                placeholder="YOUR NAME"
                required
                className="w-full bg-transparent text-[#000000] font-display font-bold uppercase border-b-2 border-[#000000] outline-none placeholder:text-[#000000] placeholder:opacity-30"
                style={{
                  height: '80px',
                  fontSize: 'clamp(1.25rem, 2vw, 2rem)',
                  letterSpacing: '-0.02em',
                  padding: '0',
                }}
              />
            </div>

            <div className="form-field" style={{ opacity: 0 }}>
              <input
                type="email"
                name="email"
                placeholder="YOUR EMAIL"
                required
                className="w-full bg-transparent text-[#000000] font-display font-bold uppercase border-b-2 border-[#000000] outline-none placeholder:text-[#000000] placeholder:opacity-30"
                style={{
                  height: '80px',
                  fontSize: 'clamp(1.25rem, 2vw, 2rem)',
                  letterSpacing: '-0.02em',
                  padding: '0',
                }}
              />
            </div>

            <div className="form-field" style={{ opacity: 0 }}>
              <textarea
                name="message"
                placeholder="TELL US ABOUT YOUR PROJECT"
                required
                className="w-full bg-transparent text-[#000000] font-display font-bold uppercase border-b-2 border-[#000000] outline-none placeholder:text-[#000000] placeholder:opacity-30 resize-none"
                style={{
                  height: '160px',
                  fontSize: 'clamp(1.25rem, 2vw, 2rem)',
                  letterSpacing: '-0.02em',
                  padding: '0',
                }}
              />
            </div>

            <div className="form-field" style={{ opacity: 0 }}>
              <button
                type="submit"
                disabled={submitting}
                className="w-full font-display font-bold uppercase bg-[#000000] text-[#DFE104] hover:bg-[#09090B] transition-colors duration-300 disabled:opacity-50"
                style={{
                  height: '64px',
                  fontSize: 'clamp(1rem, 1.5vw, 1.25rem)',
                  letterSpacing: '-0.02em',
                  borderRadius: '0',
                }}
              >
                {submitting ? 'Sending...' : 'Send Message'}
              </button>
              {error && (
                <p className="text-[#000000] font-display font-bold uppercase text-xs sm:text-sm mt-3 text-center bg-white/20 p-2 border border-black/30 backdrop-blur-sm">
                  Error sending message. Please try again.
                </p>
              )}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
