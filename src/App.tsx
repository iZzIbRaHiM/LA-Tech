import { lazy, Suspense } from 'react';
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
