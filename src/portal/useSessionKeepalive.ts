import { useEffect } from 'react';
import { api } from './api';

// Work-session keepalive.
//
// The server credits online_minutes from any authenticated request, but every
// other timer in the portal runs through usePolling, which stops completely
// while document.hidden is true. A portal left open in a background tab
// therefore made no requests at all and accrued no time: a full day logged in
// reported as a couple of hours "active".
//
// This timer deliberately ignores visibility. It is the one exception to the
// don't-poll-a-hidden-tab rule, because the thing being measured is precisely
// "was this session alive", which does not stop being true when the tab loses
// focus.
//
// Cost is kept in proportion: only while a check-in is actually open does it
// beat at the fast cadence. With no session to credit it drops to a slow probe,
// which is just enough to notice a check-in that happened in another tab.
const BEAT_OPEN_MS = 3 * 60_000;
const BEAT_IDLE_MS = 10 * 60_000;

/**
 * @param enabled false for accounts with no attendance record to accrue against
 *                (the CEO), so they never pay for the request at all.
 */
export function useSessionKeepalive(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const beat = async () => {
      if (stopped) return;
      // Default to the slow cadence: a failed request must not leave the client
      // hammering a server that is already unhappy.
      let next = BEAT_IDLE_MS;
      try {
        const r = await api<{ ok: boolean; sessionOpen: boolean }>('/attendance/heartbeat', {
          method: 'POST',
        });
        next = r.sessionOpen ? BEAT_OPEN_MS : BEAT_IDLE_MS;
      } catch {
        /* offline or 5xx — retry on the slow cadence */
      }
      if (!stopped) timer = setTimeout(beat, next);
    };

    // A backgrounded tab has its timers throttled and can be frozen outright,
    // so beat the moment focus returns. That single beat credits the gap up to
    // the server's per-beat cap, which is what keeps a long background stretch
    // from being discarded entirely.
    const onVisibility = () => {
      if (!document.hidden && !stopped) {
        if (timer) clearTimeout(timer);
        void beat();
      }
    };

    void beat();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
