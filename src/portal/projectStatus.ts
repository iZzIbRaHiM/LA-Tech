// Project status presentation, in one place so the list, the detail header and
// the edit dialog can't drift apart.
//
// The stored values are the ones the database CHECK constraint allows
// ('active','on_hold','completed','archived') and are deliberately left alone —
// 'active' is simply *labelled* "Ongoing", which is what people call it. Adding
// a separate 'ongoing' value would mean two names for one state, a migration of
// live rows, and a permanent question about which one a project should use.
export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: 'Ongoing',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

// Ongoing carries the live accent; completed reads as a settled success;
// on hold warns; archived recedes.
export const PROJECT_STATUS_BADGE: Record<string, string> = {
  active: 'text-[#DFE104] border-[#DFE104]/40',
  on_hold: 'text-amber-400 border-amber-900',
  completed: 'text-emerald-400 border-emerald-900',
  archived: 'text-[#71717A] border-[#333]',
};

/** Falls back to the raw value so an unexpected status is visible, not blank. */
export function projectStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return PROJECT_STATUS_LABEL[status] ?? status.replace('_', ' ');
}

export function projectStatusBadge(status: string | null | undefined): string {
  return PROJECT_STATUS_BADGE[status ?? ''] ?? 'text-[#A1A1AA] border-[#333]';
}
