import { useSyncExternalStore } from 'react';

// "Now", as a stored-shape UTC string, that re-renders on an interval.
//
// Implemented as an external store rather than useState + setInterval so the
// current time is read during render (correct on the very first paint) without
// calling an impure function in the component body. One shared ticker serves
// every subscriber, so N components watching the clock cost one timer.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let snapshot = '';

// Fixed rather than a hook argument: the ticker is shared, so a per-caller
// period would mean whichever component mounted first silently decided it for
// everyone. 30s is fine for minute-resolution durations.
const TICK_MS = 30000;

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function tick() {
  const next = stamp();
  // getSnapshot must be referentially stable between real changes, or
  // useSyncExternalStore re-renders forever.
  if (next === snapshot) return;
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (!timer) {
    snapshot = stamp();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): string {
  if (!snapshot) snapshot = stamp();
  return snapshot;
}

/** Current UTC instant in stored 'YYYY-MM-DD HH:MM:SS' shape, re-read on a timer. */
export function useTickingUtcNow(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
