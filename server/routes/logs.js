import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// ── Shared logger (also exported for use by other routes) ─────────────────────
export function dbLog(level, source, message, { stack, context } = {}) {
  try {
    db.prepare(`
      INSERT INTO error_logs (level, source, message, stack, context)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      level,
      String(source).slice(0, 120),
      String(message).slice(0, 2000),
      stack ? String(stack).slice(0, 4000) : null,
      context !== undefined ? JSON.stringify(context).slice(0, 2000) : null,
    );
  } catch {
    // never throw from logger
  }
}

// ── POST /api/logs  — client-side error reporting ────────────────────────────
router.post('/', (req, res) => {
  const { level = 'error', source, message, stack, context } = req.body ?? {};
  if (!source || !message) return res.status(400).json({ error: 'source and message required' });
  const validLevel = ['error', 'warn', 'info'].includes(level) ? level : 'error';
  dbLog(validLevel, source, message, { stack, context });
  res.json({ ok: true });
});

// ── GET /api/logs  — list recent entries ─────────────────────────────────────
// Query params: limit (default 200, max 1000), level (filter), since (unix epoch)
router.get('/', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const level = req.query.level;
    const since = req.query.since ? Number(req.query.since) : 0;

    let sql = `
      SELECT id, level, source, message, stack, context, created_at
      FROM   error_logs
      WHERE  created_at >= ?
    `;
    const params = [since];

    if (level && ['error', 'warn', 'info'].includes(level)) {
      sql += ` AND level = ?`;
      params.push(level);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    const total = db.prepare('SELECT COUNT(*) AS n FROM error_logs').get().n;

    res.json({ logs: rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/logs/stats  — summary counts per level ──────────────────────────
router.get('/stats', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT level, COUNT(*) AS count
      FROM   error_logs
      GROUP  BY level
    `).all();
    const stats = { error: 0, warn: 0, info: 0 };
    rows.forEach((r) => { stats[r.level] = r.count; });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/logs  — clear all (or older than ?before=epoch) ───────────────
router.delete('/', (req, res) => {
  try {
    const before = req.query.before ? Number(req.query.before) : null;
    const stmt = before
      ? db.prepare('DELETE FROM error_logs WHERE created_at < ?')
      : db.prepare('DELETE FROM error_logs');
    const info = before ? stmt.run(before) : stmt.run();
    res.json({ deleted: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
