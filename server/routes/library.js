import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// ── Bookmarks ──────────────────────────────────────────────────────────────

// GET /api/library/bookmarks?type=channel|vod|series
router.get('/bookmarks', (req, res) => {
  const { type } = req.query;
  const rows = type
    ? db.prepare('SELECT * FROM bookmarks WHERE type = ? ORDER BY added_at DESC').all(type)
    : db.prepare('SELECT * FROM bookmarks ORDER BY added_at DESC').all();
  res.json({ bookmarks: rows });
});

// POST /api/library/bookmarks  — add (idempotent)
router.post('/bookmarks', (req, res) => {
  const { id, type, title, logo, thumb, group_name, category_id, url, year, rating, source } = req.body;
  if (!id || !type || !title) return res.status(400).json({ error: 'id, type, title required' });

  const src = source === 'seedbox' ? 'seedbox' : 'iptv';

  db.prepare(`
    INSERT INTO bookmarks (id, type, title, logo, thumb, group_name, category_id, url, year, rating, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, type) DO UPDATE SET
      title  = excluded.title,
      logo   = excluded.logo,
      thumb  = excluded.thumb,
      source = excluded.source
  `).run(id, type, title, logo ?? null, thumb ?? null, group_name ?? null, category_id ?? null, url ?? null, year ?? null, rating ?? null, src);

  const rows = db.prepare('SELECT * FROM bookmarks WHERE type = ? ORDER BY added_at DESC').all(type);
  res.json({ bookmarks: rows });
});

// DELETE /api/library/bookmarks/:id?type=channel|vod|series
router.delete('/bookmarks/:id', (req, res) => {
  const { type } = req.query;
  const { id } = req.params;
  if (!type) return res.status(400).json({ error: 'type query param required' });

  db.prepare('DELETE FROM bookmarks WHERE id = ? AND type = ?').run(id, type);
  const rows = db.prepare('SELECT * FROM bookmarks WHERE type = ? ORDER BY added_at DESC').all(type);
  res.json({ bookmarks: rows });
});

// ── Watch history ──────────────────────────────────────────────────────────

// GET /api/library/history?type=channel&limit=50
router.get('/history', (req, res) => {
  const { type, limit = 50 } = req.query;
  const rows = type
    ? db.prepare('SELECT * FROM watch_history WHERE type = ? ORDER BY watched_at DESC LIMIT ?').all(type, Number(limit))
    : db.prepare('SELECT * FROM watch_history ORDER BY watched_at DESC LIMIT ?').all(Number(limit));
  res.json({ history: rows });
});

// POST /api/library/history — upsert progress
router.post('/history', (req, res) => {
  const { item_id, type, title, thumb, progress = 0, duration } = req.body;
  if (!item_id || !type) return res.status(400).json({ error: 'item_id, type required' });

  db.prepare(`
    INSERT INTO watch_history (item_id, type, title, thumb, progress, duration, watched_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(item_id, type) DO UPDATE SET
      progress   = excluded.progress,
      duration   = excluded.duration,
      title      = excluded.title,
      thumb      = excluded.thumb,
      watched_at = unixepoch()
  `).run(item_id, type, title ?? null, thumb ?? null, progress, duration ?? null);

  res.json({ ok: true });
});

// DELETE /api/library/history/:id
router.delete('/history/:id', (req, res) => {
  db.prepare('DELETE FROM watch_history WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Custom lists ───────────────────────────────────────────────────────────

// GET /api/library/lists
router.get('/lists', (req, res) => {
  const lists = db.prepare('SELECT * FROM custom_lists ORDER BY created_at DESC').all();
  const counts = db.prepare('SELECT list_id, COUNT(*) as count FROM list_items GROUP BY list_id').all();
  const countMap = Object.fromEntries(counts.map((c) => [c.list_id, c.count]));
  res.json({ lists: lists.map((l) => ({ ...l, count: countMap[l.id] ?? 0 })) });
});

// POST /api/library/lists — create
router.post('/lists', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO custom_lists (name, description) VALUES (?, ?)').run(name, description ?? null);
  res.json({ id: result.lastInsertRowid });
});

// DELETE /api/library/lists/:id
router.delete('/lists/:id', (req, res) => {
  db.prepare('DELETE FROM custom_lists WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// GET /api/library/lists/:id — list + items
router.get('/lists/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM custom_lists WHERE id = ?').get(Number(req.params.id));
  if (!list) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare('SELECT * FROM list_items WHERE list_id = ? ORDER BY added_at DESC').all(Number(req.params.id));
  res.json({ list, items });
});

// POST /api/library/lists/:id/items — add item
router.post('/lists/:id/items', (req, res) => {
  const { item_id, type, title, thumb } = req.body;
  if (!item_id || !type) return res.status(400).json({ error: 'item_id, type required' });
  db.prepare(`
    INSERT OR IGNORE INTO list_items (list_id, item_id, type, title, thumb)
    VALUES (?, ?, ?, ?, ?)
  `).run(Number(req.params.id), item_id, type, title ?? null, thumb ?? null);
  res.json({ ok: true });
});

// DELETE /api/library/lists/:id/items/:itemId
router.delete('/lists/:id/items/:itemId', (req, res) => {
  db.prepare('DELETE FROM list_items WHERE list_id = ? AND item_id = ?')
    .run(Number(req.params.id), req.params.itemId);
  res.json({ ok: true });
});

export default router;
