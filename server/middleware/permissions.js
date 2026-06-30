// RBAC enforcement middleware. Runs after requireAuth (req.user is set) and
// before the protected route handlers. It checks the authenticated user's
// granted views against the requested route, and enforces the read-only
// seedbox grant. Admins bypass all checks.

import db from '../db/index.js';
import { resolveAllowedViews } from '../config/views.js';
import { canAccessRoute, isSeedboxMutation } from '../config/permissions.js';

export function enforcePermissions(req, res, next) {
  // requireAuth runs first; if somehow not, fail closed.
  if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  // Re-read from DB so permission changes take effect immediately (no need to
  // re-issue the JWT). SQLite is in-process — this is a cheap local read.
  const user = db.prepare('SELECT role, allowed_views, seedbox_readonly FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const role = user.role || 'user';
  if (role === 'admin') return next(); // admins are never restricted

  const allowedViews = resolveAllowedViews(role, user.allowed_views);

  // View-scoped route gating.
  if (!canAccessRoute(req.path, allowedViews)) {
    return res.status(403).json({ error: 'Not authorized for this view' });
  }

  // Read-only seedbox: block any mutating seedbox call.
  if (user.seedbox_readonly && isSeedboxMutation(req.path, req.method)) {
    return res.status(403).json({ error: 'Read-only seedbox access' });
  }

  next();
}
