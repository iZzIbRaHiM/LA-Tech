import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function useCountUp(target: number, durationMs = 700): number {
  // Read the preference during render instead of branching inside the effect:
  // the old version called setDisplay(target) synchronously in the effect body
  // for reduced-motion users, which forces a second render pass on every
  // change. Now the final value is simply derived.
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reduce) {
      // Keep the ref in step so that toggling the preference back on animates
      // from the value actually on screen rather than from a stale one.
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduce]);

  return reduce ? target : display;
}
