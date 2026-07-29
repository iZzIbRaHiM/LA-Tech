import { useCallback, useSyncExternalStore } from 'react';

// A boolean persisted in localStorage, read as an external store rather than
// copied into state by an effect. Reading it during render means the value is
// correct on the first paint (no flash of the pre-dismissal UI), and because
// `set` notifies subscribers the same flag stays in step across open tabs.
//
// The native `storage` event only fires in *other* tabs, so `set` dispatches a
// private event for the current one.
const LOCAL_EVENT = 'latech:stored-flag';

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(LOCAL_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(LOCAL_EVENT, onStoreChange);
  };
}

/**
 * @param key localStorage key, or null while it isn't known yet (e.g. before
 *            the signed-in user has loaded). A null key always reads false and
 *            ignores writes.
 */
export function useStoredFlag(key: string | null): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      if (!key) return false;
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false; // Private mode / storage disabled.
      }
    },
    () => false
  );

  const set = useCallback(
    (next: boolean) => {
      if (!key) return;
      try {
        if (next) localStorage.setItem(key, '1');
        else localStorage.removeItem(key);
      } catch {
        /* storage unavailable — the in-memory value below still updates */
      }
      window.dispatchEvent(new Event(LOCAL_EVENT));
    },
    [key]
  );

  return [value, set];
}
