import type { LucideIcon } from 'lucide-react';

// Shared empty-state treatment — every list page previously fell back to a
// bare "No X yet." line of text with no visual weight, unlike the loading
// skeletons that already got real design attention.
export default function EmptyState({
  icon: Icon,
  title,
  hint,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`animate-fade-up flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      <span className="dialog-icon-badge mb-3" style={{ width: 44, height: 44 }}>
        <Icon size={20} />
      </span>
      <p className="text-sm text-[#A1A1AA]">{title}</p>
      {hint && <p className="text-xs text-[#71717A] mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}
