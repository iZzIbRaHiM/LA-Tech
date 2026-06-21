import Navigation from '@/sections/Navigation';
import Hero from '@/sections/Hero';
import StatsMarquee from '@/sections/StatsMarquee';
import Services from '@/sections/Services';
import Portfolio from '@/sections/Portfolio';
import TrustedBy from '@/sections/TrustedBy';
import Process from '@/sections/Process';
import Contact from '@/sections/Contact';
import Footer from '@/sections/Footer';
import { Analytics } from '@vercel/analytics/react';

// Noise texture overlay component
function NoiseOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-[100]"
      style={{
        opacity: 0.03,
        mixBlendMode: 'overlay',
      }}
    >
      <svg width="100%" height="100%">
        <title>Noise texture</title>
        <filter id="noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="4"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  );
}

export default function App() {
  return (
    <div className="relative bg-[#09090B] min-h-screen">
      <NoiseOverlay />
      <Navigation />
      <main>
        <Hero />
        <StatsMarquee />
        <Services />
        <Portfolio />
        <TrustedBy />
        <Process />
        <Contact />
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
