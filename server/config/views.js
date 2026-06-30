// Canonical list of user-facing views (sidebar sections) that an admin can
// authorize per user. Keep ids in sync with the frontend Sidebar/MainLayout
// PAGES map. 'mission-control' is intentionally excluded — it is admin-only and
// gated by role, not by per-user view permissions.

export const VIEWS = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'livetv', label: 'Live TV' },
  { id: 'news', label: 'News' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'settings', label: 'Settings' },
];

export const VIEW_IDS = VIEWS.map((v) => v.id);

// Resolve a user's effective allowed views.
//  - admins: all views
//  - allowed_views NULL/unset: all views (backward compatible)
//  - otherwise: the stored subset (filtered to valid ids)
export function resolveAllowedViews(role, allowedViewsJson) {
  if (role === 'admin') return [...VIEW_IDS];
  if (allowedViewsJson == null) return [...VIEW_IDS];
  try {
    const parsed = JSON.parse(allowedViewsJson);
    if (!Array.isArray(parsed)) return [...VIEW_IDS];
    return VIEW_IDS.filter((id) => parsed.includes(id));
  } catch {
    return [...VIEW_IDS];
  }
}
