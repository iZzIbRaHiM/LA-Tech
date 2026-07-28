import type { LucideIcon } from 'lucide-react';

// Shared empty-state treatment — list pages previously fell back to a bare
// "No X yet." line with no visual weight, unlike the loading skeletons that
// already got real design attention.
//
// `compact` exists because the full-size treatment (py-12, 44px badge) is
// right for a primary content area but overwhelms a small panel — a chart
// cell, a tab body, a side sheet. Same visual language, smaller footprint,
// so those surfaces stay consistent instead of falling back to bare text.
export default function EmptyState({
  icon: Icon,
  title,
  hint,
  compact = false,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  compact?: boolean;
  className?: string;
}) {
  const badge = compact ? 32 : 44;
  return (
    <div
      className={`animate-fade-up flex flex-col items-center justify-center text-center px-4 ${
        compact ? 'py-6' : 'py-12'
      } ${className}`}
    >
      <span className="dialog-icon-badge mb-2.5" style={{ width: badge, height: badge }}>
        <Icon size={compact ? 15 : 20} />
      </span>
      <p className={`${compact ? 'text-xs' : 'text-sm'} text-[#A1A1AA]`}>{title}</p>
      {hint && <p className="text-xs text-[#71717A] mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}
