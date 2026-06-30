/**
 * Mission Control — Admin-only API routes
 * All routes require authenticated admin user.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import db from '../db/index.js';
import { execSync } from 'child_process';
import os from 'os';
import bcrypt from 'bcryptjs';
import { VIEWS, VIEW_IDS, resolveAllowedViews } from '../config/views.js';

const router = Router();

// All admin routes require admin role
router.use(requireAdmin);

// ── GET /api/admin/overview ─────────────────────────────────────────────────
// System overview: server stats, library counts, DB size
router.get('/overview', (req, res) => {
  try {
    const users = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    const movies = db.prepare("SELECT COUNT(*) as n FROM watch_history WHERE type = 'vod'").get().n;
    const subtitlesCached = db.prepare('SELECT COUNT(*) as n FROM subtitle_cache').get().n;
    const errorCount = db.prepare("SELECT COUNT(*) as n FROM error_logs WHERE level = 'error'").get().n;
    const warnCount = db.prepare("SELECT COUNT(*) as n FROM error_logs WHERE level = 'warn'").get().n;

    // DB file size
    let dbSize = 0;
    try {
      const row = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
      dbSize = row?.size || 0;
    } catch {}

    // Subtitle cache size
    let subCacheSize = 0;
    try {
      const row = db.prepare("SELECT SUM(LENGTH(vtt)) as size FROM subtitle_cache").get();
      subCacheSize = row?.size || 0;
    } catch {}

    res.json({
      server: {
        uptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()}`,
        memoryUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        memoryTotal: Math.round(os.totalmem() / 1024 / 1024),
        pid: process.pid,
      },
      counts: {
        users,
        subtitlesCached,
        errors: errorCount,
        warnings: warnCount,
      },
      dbSize,
      subCacheSize,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/users ────────────────────────────────────────────────────
router.get('/views', (_req, res) => {
  res.json({ views: VIEWS });
});

router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, allowed_views, created_at FROM users ORDER BY id').all();
  const users = rows.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role || 'user',
    created_at: u.created_at,
    allowedViews: resolveAllowedViews(u.role || 'user', u.allowed_views),
  }));
  res.json({ users });
});

// PUT /api/admin/users/:id/views — set a user's authorized views
router.put('/users/:id/views', (req, res) => {
  const { views } = req.body;
  if (!Array.isArray(views)) return res.status(400).json({ error: 'views must be an array' });
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if ((target.role || 'user') === 'admin') {
    return res.status(400).json({ error: 'Admins always have access to all views' });
  }
  const clean = VIEW_IDS.filter((id) => views.includes(id));
  db.prepare('UPDATE users SET allowed_views = ? WHERE id = ?').run(JSON.stringify(clean), req.params.id);
  res.json({ ok: true, allowedViews: clean });
});

// ── PUT /api/admin/users/:id/role ───────────────────────────────────────────
router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  // Prevent demoting yourself
  if (Number(req.params.id) === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot demote yourself' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

// ── POST /api/admin/users — create a new user ──────────────────────────────
router.post('/users', async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    res.json({ ok: true });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/users/:id ─────────────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── GET /api/admin/logs ─────────────────────────────────────────────────────
router.get('/logs', (req, res) => {
  const { level, limit = 50 } = req.query;
  let query = 'SELECT * FROM error_logs';
  const params = [];
  if (level) { query += ' WHERE level = ?'; params.push(level); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit));

  const logs = db.prepare(query).all(...params);
  res.json({ logs });
});

// ── DELETE /api/admin/logs ──────────────────────────────────────────────────
router.delete('/logs', (req, res) => {
  db.prepare('DELETE FROM error_logs').run();
  res.json({ ok: true, cleared: true });
});

// ── GET /api/admin/subtitle-cache ───────────────────────────────────────────
router.get('/subtitle-cache', (req, res) => {
  const entries = db.prepare(
    "SELECT key, LENGTH(vtt) as size, created_at FROM subtitle_cache ORDER BY created_at DESC LIMIT 100"
  ).all();
  res.json({ entries });
});

// ── DELETE /api/admin/subtitle-cache ────────────────────────────────────────
router.delete('/subtitle-cache', (req, res) => {
  const info = db.prepare('DELETE FROM subtitle_cache').run();
  res.json({ ok: true, deleted: info.changes });
});

export default router;
