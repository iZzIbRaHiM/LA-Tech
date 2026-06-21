import { useRef, useEffect, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

const projects = [
  { src: './images/portfolio-1.jpg', name: 'Hospital Management System' },
  { src: './images/portfolio-2.jpg', name: 'Education Portal' },
  { src: './images/portfolio-3.jpg', name: 'Enterprise ERP' },
  { src: './images/portfolio-4.jpg', name: 'SaaS Platform' },
  { src: './images/portfolio-5.jpg', name: 'Logistics Tracker' },
  { src: './images/portfolio-6.jpg', name: 'Government Portal' },
];

const numItems = 6;

function radToDeg(rad: number) {
  return rad * (180 / Math.PI);
}

function getCardDimensions() {
  if (typeof window === 'undefined') return { cardWidth: 400, cardHeight: 200 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  if (w < 768) {
    // Mobile: landscape aspect ratio 2.0 (wider & shorter)
    return { cardWidth: 320, cardHeight: 160 };
  } else if (w < 1024) {
    // Tablet
    return { cardWidth: 480, cardHeight: 240 };
  } else {
    // Desktop - scale based on height to prevent vertical overflow
    if (h < 750) {
      return { cardWidth: 540, cardHeight: 270 };
    } else if (h < 900) {
      return { cardWidth: 600, cardHeight: 300 };
    } else {
      return { cardWidth: 660, cardHeight: 330 };
    }
  }
}

export default function Portfolio() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const itemsRef = useRef<HTMLDivElement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const reducedMotion = useReducedMotion();
  const [dims, setDims] = useState(getCardDimensions);

  // Responsive card sizing on resize
  const handleResize = useCallback(() => {
    setDims(getCardDimensions());
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  const { cardWidth, cardHeight } = dims;
  const radius = cardWidth / (2 * Math.tan(Math.PI / numItems));

  // Image preloading
  useEffect(() => {
    let count = 0;
    projects.forEach((project) => {
      const img = new Image();
      img.onload = () => {
        count++;
        setLoadedCount(count);
        if (count === projects.length) {
          setTimeout(() => setLoaded(true), 100);
        }
      };
      img.onerror = () => {
        count++;
        setLoadedCount(count);
        if (count === projects.length) setLoaded(true);
      };
      img.src = project.src;
    });
  }, []);

  useEffect(() => {
    if (!loaded || !wrapperRef.current || !carouselRef.current) return;

    const ctx = gsap.context(() => {
      if (reducedMotion) return;

      // Heading entrance animation – matches Services / Process sections
      gsap.fromTo(
        titleRef.current,
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: titleRef.current,
            start: 'top 80%',
          },
        }
      );

      // Position cards in 3D circle
      itemsRef.current.forEach((item, i) => {
        if (!item) return;
        const angle = (i / numItems) * 2 * Math.PI;
        const x = Math.sin(angle) * radius;
        const z = Math.cos(angle) * radius;

        gsap.set(item, {
          x,
          z,
          rotateY: radToDeg(angle),
          transformOrigin: '50% 50%',
        });
      });

      // Create scroll-driven timeline
      const tl = gsap.timeline();

      tl.to(carouselRef.current, {
        rotationY: 360,
        ease: 'none',
        scrollTrigger: {
          trigger: wrapperRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          pin: true,
        },
      });

    }, wrapperRef);

    return () => ctx.revert();
  }, [loaded, reducedMotion, radius]);

  return (
    <section
      id="work"
      ref={wrapperRef}
      className="relative overflow-hidden bg-[#09090B]"
      style={{
        height: '100vh',
        perspective: '1800px',
      }}
    >
      {/* Loader */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#09090B]">
          <span
            className="font-display uppercase text-[#A1A1AA]"
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.5rem)',
              letterSpacing: '0.05em',
            }}
          >
            Loading Work... ({loadedCount}/{projects.length})
          </span>
        </div>
      )}

      {/* Inner container to hold padding – safe from GSAP pinning style overrides */}
      <div
        className="w-full h-full flex flex-col"
        style={{
          paddingTop: 'clamp(2rem, 4.5vw, 4.5rem)', // Moved heading up further to clear overlap
          paddingLeft: 'clamp(1.5rem, 5vw, 6rem)',
          paddingRight: 'clamp(1.5rem, 5vw, 6rem)',
        }}
      >
        {/* Section Title – now in normal flow and protected from GSAP style overrides */}
        <h2
          ref={titleRef}
          className="font-display font-bold uppercase text-[#FAFAFA]"
          style={{
            fontSize: 'clamp(2.5rem, 8vw, 8rem)',
            lineHeight: 0.85,
            letterSpacing: '-0.02em',
            opacity: 0,
          }}
        >
          Our Work
        </h2>

        {/* 3D Carousel – takes up remaining space and positions cards vertically separated from heading */}
        <div
          className="flex-1 flex items-center justify-center"
          style={{
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.5s ease',
            position: 'relative',
          }}
        >
          <div
            ref={carouselRef}
            className="relative"
            style={{
              width: '100%',
              height: '100%',
              transformStyle: 'preserve-3d',
            }}
          >
            {projects.map((project, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) itemsRef.current[i] = el;
                }}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: `${cardWidth}px`,
                  height: `${cardHeight}px`,
                  marginLeft: `-${cardWidth / 2}px`,
                  marginTop: `-${cardHeight / 2}px`,
                  transformStyle: 'preserve-3d',
                }}
              >
                <figure className="w-full h-full">
                  <img
                    src={project.src}
                    alt={project.name}
                    className="w-full h-full object-cover border-2 border-[#3F3F46]"
                    style={{ borderRadius: '0' }}
                  />
                  <figcaption
                    className="font-display uppercase text-[#A1A1AA] text-center mt-4"
                    style={{
                      fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {project.name}
                  </figcaption>
                </figure>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
