import { useSyncExternalStore } from 'react';

// Read through useSyncExternalStore rather than seeding state in an effect.
// The old version initialised to `false` and corrected itself after mount, so
// a user who prefers reduced motion still got one frame of animation on every
// mount — the exact thing the preference asks us not to do. This reports the
// real value on the first render.
const QUERY = '(prefers-reduced-motion: reduce)';

let mql: MediaQueryList | null = null;
function query(): MediaQueryList {
  if (!mql) mql = window.matchMedia(QUERY);
  return mql;
}

function subscribe(onStoreChange: () => void): () => void {
  const m = query();
  m.addEventListener('change', onStoreChange);
  return () => m.removeEventListener('change', onStoreChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false // No DOM to ask (prerender): assume motion is acceptable.
  );
}
