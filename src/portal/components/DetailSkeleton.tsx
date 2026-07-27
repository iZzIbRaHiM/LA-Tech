import { Skeleton } from '@/components/ui/skeleton';

// Shared loading placeholder for detail pages (task/project/settings) —
// mirrors the typical shape (title + a few field rows) so the page doesn't
// pop from blank to full; used in place of a bare "Loading…" string.
export default function DetailSkeleton() {
  return (
    <div className="p-8 max-w-3xl stagger">
      <Skeleton className="h-7 w-64 mb-2" />
      <Skeleton className="h-4 w-96 mb-8" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-4 w-full max-w-sm" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="mt-8 space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
