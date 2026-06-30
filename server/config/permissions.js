// Server-side RBAC: maps protected API route groups to the views that grant
// access. This backs the per-user `allowed_views` permission with real
// enforcement (the sidebar/page gating is UX only — this is the security wall).
//
// Posture: enforce what we understand, don't break what we don't. Only the
// route groups listed here are gated; anything unmapped (e.g. search helpers,
// chat, logs) is allowed for any authenticated user. Admins bypass everything.
//
// `views` is an OR set: the user needs at least one of them. Several data
// sources surface on multiple pages (e.g. the seedbox library shows on Home,
// Library, and the player), so those map to multiple views.

export const ROUTE_VIEW_MAP = [
  { prefix: '/seedbox', views: ['home', 'library', 'livetv'] },
  { prefix: '/library', views: ['home', 'library', 'livetv'] },
  { prefix: '/subtitles', views: ['home', 'library', 'livetv'] },
  { prefix: '/iptv', views: ['home', 'livetv'] },
  { prefix: '/epg', views: ['home', 'livetv'] },
  { prefix: '/qbit', views: ['downloads'] },
  { prefix: '/qbittorrent', views: ['downloads'] },
  { prefix: '/rss', views: ['home', 'news'] },
];

function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}

// Returns true if a user with `allowedViews` may call `path`. Unmapped paths
// are allowed (deny only what we explicitly gate).
export function canAccessRoute(path, allowedViews) {
  const entry = ROUTE_VIEW_MAP.find((e) => pathMatchesPrefix(path, e.prefix));
  if (!entry) return true;
  return entry.views.some((v) => allowedViews.includes(v));
}

// A seedbox call is a mutation (and thus blocked for read-only users) when it's
// not a GET against /seedbox. GET = browse/search/play/stream/subtitle.
export function isSeedboxMutation(path, method) {
  if (!pathMatchesPrefix(path, '/seedbox')) return false;
  return method.toUpperCase() !== 'GET';
}
