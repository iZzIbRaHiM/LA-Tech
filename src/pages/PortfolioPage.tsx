import { useEffect, useState } from 'react';
import Navigation from '@/sections/Navigation';
import Footer from '@/sections/Footer';
import NoiseOverlay from '@/components/NoiseOverlay';
import {
  projects,
  CATEGORY_LABELS,
  type Project,
  type ProjectCategory,
} from '@/data/projects';

type Filter = 'all' | ProjectCategory;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.entries(CATEGORY_LABELS) as [ProjectCategory, string][]).map(
    ([key, label]) => ({ key: key as Filter, label })
  ),
];

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group flex flex-col border-2 border-[#27272A] hover:border-[#DFE104] transition-colors duration-300 bg-[#0C0C0F]">
      <div className="relative overflow-hidden aspect-video border-b-2 border-[#27272A] group-hover:border-[#DFE104] transition-colors duration-300">
        <img
          src={project.image}
          alt={project.name}
          loading="lazy"
          className="w-full h-full object-cover bg-[#09090B] transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <div className="flex flex-col flex-1 p-6 gap-3">
        <span
          className="font-display uppercase text-[#DFE104]"
          style={{ fontSize: '0.75rem', letterSpacing: '0.1em' }}
        >
          {CATEGORY_LABELS[project.category]}
        </span>
        <h3
          className="font-display font-bold uppercase text-[#FAFAFA]"
          style={{ fontSize: 'clamp(1.25rem, 2vw, 1.6rem)', lineHeight: 1, letterSpacing: '-0.02em' }}
        >
          {project.name}
        </h3>
        <p className="text-[#A1A1AA] text-sm leading-relaxed line-clamp-3">
          {project.description}
        </p>
        <div className="flex flex-wrap gap-2 mt-auto pt-2">
          {project.tech.map((t) => (
            <span
              key={t}
              className="font-display uppercase text-[#71717A] border border-[#3F3F46] px-2 py-1"
              style={{ fontSize: '0.65rem', letterSpacing: '0.05em' }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 pt-3">
          {project.liveUrl && (
            <a
              href={project.liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200 inline-flex items-center"
              style={{ height: '34px', padding: '0 1rem', fontSize: '0.75rem', letterSpacing: '-0.02em' }}
            >
              Visit Site ↗
            </a>
          )}
          {project.storeUrl && (
            <a
              href={project.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200 inline-flex items-center"
              style={{ height: '34px', padding: '0 1rem', fontSize: '0.75rem', letterSpacing: '-0.02em' }}
            >
              Google Play ↗
            </a>
          )}
          {project.githubUrl && (
            <a
              href={project.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display font-bold uppercase text-[#FAFAFA] border-2 border-[#3F3F46] hover:border-[#DFE104] hover:text-[#DFE104] transition-all duration-200 inline-flex items-center"
              style={{ height: '34px', padding: '0 1rem', fontSize: '0.75rem', letterSpacing: '-0.02em' }}
            >
              GitHub ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function PortfolioPage() {
  const [filter, setFilter] = useState<Filter>('all');

  // SPA navigation preserves scroll position — this page should open at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const visible =
    filter === 'all' ? projects : projects.filter((p) => p.category === filter);

  return (
    <div className="relative bg-[#09090B] min-h-screen">
      <NoiseOverlay />
      <Navigation />
      <main
        style={{
          paddingTop: '120px',
          paddingLeft: 'clamp(1.5rem, 5vw, 6rem)',
          paddingRight: 'clamp(1.5rem, 5vw, 6rem)',
          paddingBottom: 'clamp(4rem, 8vw, 8rem)',
        }}
      >
        {/* Hero */}
        <header className="mb-12">
          <h1
            className="font-display font-bold uppercase text-[#FAFAFA]"
            style={{
              fontSize: 'clamp(2.5rem, 8vw, 8rem)',
              lineHeight: 0.85,
              letterSpacing: '-0.02em',
            }}
          >
            Our <span className="text-[#DFE104]">Portfolio</span>
          </h1>
          <p
            className="text-[#A1A1AA] mt-6 max-w-2xl"
            style={{ fontSize: 'clamp(1rem, 1.5vw, 1.25rem)', lineHeight: 1.6 }}
          >
            {projects.length} products spanning AI SaaS, enterprise platforms,
            Web3, e-commerce, and mobile — designed and built end-to-end by LA
            Tech Solutions.
          </p>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-12">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  'font-display font-bold uppercase transition-all duration-200 border-2 ' +
                  (active
                    ? 'bg-[#DFE104] text-[#000000] border-[#DFE104]'
                    : 'text-[#A1A1AA] border-[#3F3F46] hover:border-[#DFE104] hover:text-[#DFE104]')
                }
                style={{
                  height: '40px',
                  padding: '0 1.25rem',
                  fontSize: 'clamp(0.7rem, 0.9vw, 0.95rem)',
                  letterSpacing: '-0.02em',
                  borderRadius: '0',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
          {visible.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
