import { useRef, useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { featuredProjects, CATEGORY_LABELS, type Project } from '@/data/projects';
import ProjectModal from '@/components/ProjectModal';

gsap.registerPlugin(ScrollTrigger);

const projects = featuredProjects;

const numItems = projects.length;

function radToDeg(rad: number) {
  return rad * (180 / Math.PI);
}

function getCardDimensions() {
  if (typeof window === 'undefined') return { cardWidth: 400, cardHeight: 200 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  let cardWidth = 400;
  if (w < 768) {
    // Mobile: 82% of screen width, max 320px
    cardWidth = Math.min(w * 0.82, 320);
  } else if (w < 1024) {
    // Tablet: 62% of screen width, max 480px
    cardWidth = Math.min(w * 0.62, 480);
  } else {
    // Desktop - scale based on height to prevent vertical overflow
    if (h < 750) {
      cardWidth = Math.min(w * 0.45, 560);
    } else if (h < 900) {
      cardWidth = Math.min(w * 0.5, 680);
    } else {
      cardWidth = Math.min(w * 0.5, 760);
    }
  }
  
  // Aspect ratio is exactly 2.0 (wider & shorter)
  const cardHeight = Math.round(cardWidth / 2);
  return { cardWidth: Math.round(cardWidth), cardHeight };
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
  const [selected, setSelected] = useState<Project | null>(null);

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
      img.src = project.image;
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            ref={titleRef}
            className="font-display font-bold uppercase text-[#FAFAFA]"
            style={{
              fontSize: 'clamp(2.25rem, 6vw, 5.5rem)',
              lineHeight: 0.9,
              letterSpacing: '-0.02em',
              opacity: 0,
            }}
          >
            Our Work
          </h2>
          <Link
            to="/portfolio"
            className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200"
            style={{
              height: '40px',
              padding: '0 1.5rem',
              fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
              letterSpacing: '-0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '0',
            }}
          >
            View All Projects →
          </Link>
        </div>

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
                  // Cards on the far side of the ring otherwise render
                  // mirrored through the front cards, garbling the captions.
                  backfaceVisibility: 'hidden',
                }}
              >
                <figure className="w-full h-full">
                  <button
                    type="button"
                    onClick={() => setSelected(project)}
                    aria-label={`View ${project.name} details`}
                    className="block w-full h-full cursor-pointer"
                  >
                    <img
                      src={project.image}
                      alt={project.name}
                      className="w-full h-full object-cover border-2 border-[#3F3F46] bg-[#09090B] hover:border-[#DFE104] transition-colors duration-300"
                      style={{ borderRadius: '0' }}
                    />
                  </button>
                  <figcaption
                    className="text-center mt-4"
                    style={{ fontSize: 'clamp(0.75rem, 1vw, 1.125rem)' }}
                  >
                    {/* Solid backdrop so partially-rotated neighbors can't
                        bleed through the label and blur it. */}
                    <span
                      className="font-display uppercase inline-block bg-[#09090B] px-4 py-2"
                      style={{ letterSpacing: '0.05em' }}
                    >
                      <span className="text-[#FAFAFA]">{project.name}</span>
                      <span className="block text-[#71717A]" style={{ fontSize: '0.75em' }}>
                        {CATEGORY_LABELS[project.category]}
                      </span>
                    </span>
                  </figcaption>
                </figure>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ProjectModal project={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
