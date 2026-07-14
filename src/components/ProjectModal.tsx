import { useEffect } from 'react';
import { CATEGORY_LABELS, type Project } from '@/data/projects';

export default function ProjectModal({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [project, onClose]);

  if (!project) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ padding: 'clamp(1rem, 4vw, 3rem)' }}
      role="dialog"
      aria-modal="true"
      aria-label={project.name}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[#09090B]/90 backdrop-blur-sm cursor-default"
      />

      {/* Panel */}
      <div
        className="relative w-full bg-[#0C0C0F] border-2 border-[#3F3F46] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
        style={{ maxWidth: '860px', maxHeight: '90vh' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close project details"
          className="absolute top-4 right-4 z-10 flex items-center justify-center bg-[#09090B]/80 border-2 border-[#3F3F46] text-[#FAFAFA] hover:border-[#DFE104] hover:text-[#DFE104] transition-colors duration-200"
          style={{ width: '40px', height: '40px' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="2" y1="2" x2="16" y2="16" />
            <line x1="16" y1="2" x2="2" y2="16" />
          </svg>
        </button>

        <div className="aspect-video border-b-2 border-[#3F3F46] overflow-hidden">
          <img
            src={project.image}
            alt={project.name}
            className="w-full h-full object-cover bg-[#09090B]"
          />
        </div>

        <div style={{ padding: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
          <span
            className="font-display uppercase text-[#DFE104]"
            style={{ fontSize: '0.75rem', letterSpacing: '0.12em' }}
          >
            {CATEGORY_LABELS[project.category]}
          </span>
          <h2
            className="font-display font-bold uppercase text-[#FAFAFA] mt-2"
            style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', lineHeight: 1.05, letterSpacing: '-0.02em' }}
          >
            {project.name}
          </h2>
          <p
            className="text-[#D4D4D8] mt-4"
            style={{ fontSize: 'clamp(1rem, 1.2vw, 1.125rem)', lineHeight: 1.7, maxWidth: '65ch' }}
          >
            {project.description}
          </p>

          <div className="flex flex-wrap gap-2 mt-6">
            {project.tech.map((t) => (
              <span
                key={t}
                className="font-display uppercase text-[#A1A1AA] border border-[#3F3F46] px-2.5 py-1"
                style={{ fontSize: '0.7rem', letterSpacing: '0.05em' }}
              >
                {t}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mt-8">
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200 inline-flex items-center"
                style={{ height: '44px', padding: '0 1.5rem', fontSize: '0.85rem', letterSpacing: '-0.02em' }}
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
                style={{ height: '44px', padding: '0 1.5rem', fontSize: '0.85rem', letterSpacing: '-0.02em' }}
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
                style={{ height: '44px', padding: '0 1.5rem', fontSize: '0.85rem', letterSpacing: '-0.02em' }}
              >
                GitHub ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
