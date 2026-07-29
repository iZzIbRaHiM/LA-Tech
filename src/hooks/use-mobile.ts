import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// Subscribed through useSyncExternalStore instead of seeding state in an
// effect. The previous version started as `undefined` (coerced to false), so
// the first render always claimed "desktop" and corrected itself immediately
// after mount — on a phone that meant a visible flash of the desktop layout.
let mql: MediaQueryList | null = null
function query(): MediaQueryList {
  if (!mql) mql = window.matchMedia(QUERY)
  return mql
}

function subscribe(onStoreChange: () => void): () => void {
  const m = query()
  m.addEventListener("change", onStoreChange)
  return () => m.removeEventListener("change", onStoreChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false
  )
}
