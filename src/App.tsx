import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router';
import Navigation from '@/sections/Navigation';
import Hero from '@/sections/Hero';
import StatsMarquee from '@/sections/StatsMarquee';
import Services from '@/sections/Services';
import Portfolio from '@/sections/Portfolio';
import Process from '@/sections/Process';
import Contact from '@/sections/Contact';
import Footer from '@/sections/Footer';
import NoiseOverlay from '@/components/NoiseOverlay';
import { Analytics } from '@vercel/analytics/react';

// Below the fold — deferring keeps it out of the initial bundle.
const TrustedBy = lazy(() => import('@/sections/TrustedBy'));

export default function App() {
  const location = useLocation();

  // Client-side route changes (e.g. arriving here from /portfolio via
  // navigate('/#services')) don't auto-scroll like a browser hash jump does
  // — do it manually once mounted. A short delay (rather than a single
  // rAF) lets the section GSAP ScrollTriggers finish their pin/layout
  // setup first, since Portfolio's #work section pins on mount and would
  // otherwise shift the target position out from under an immediate scroll.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
    return () => clearTimeout(timer);
  }, [location.hash]);

  return (
    <div className="relative bg-[#09090B] min-h-screen">
      <NoiseOverlay />
      <Navigation />
      <main>
        <Hero />
        <StatsMarquee />
        <Services />
        <Portfolio />
        <Suspense fallback={null}>
          <TrustedBy />
        </Suspense>
        <Process />
        <Contact />
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
