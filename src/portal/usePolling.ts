import { useEffect, useRef } from 'react';

// Poll only while the tab is actually visible. A portal tab parked in the
// background all day otherwise generates thousands of requests — and on
// the free tiers both Vercel invocations and Supabase egress are metered,
// so background polling is pure quota burn for zero user value.
// Fires immediately on mount and again the moment the tab regains
// visibility, so returning users always see fresh data.
export function usePolling(fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      fnRef.current();
      interval = setInterval(() => fnRef.current(), ms);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}
