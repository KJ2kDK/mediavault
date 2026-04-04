import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const API = 'https://predb.club/api/v1';

// ── In-memory cache (60s TTL) ────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 60_000;

function cached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── Rate-limit tracking (30 req / 60s) ──────────────────────────────────────
const reqLog = [];

function canRequest() {
  const now = Date.now();
  while (reqLog.length && reqLog[0] < now - 60_000) reqLog.shift();
  return reqLog.length < 28; // leave headroom
}

function logRequest() {
  reqLog.push(Date.now());
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(mb) {
  if (!mb || mb <= 0) return '';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function formatTime(epoch) {
  if (!epoch) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - epoch;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
}

// ── GET /api/predb/releases ─────────────────────────────────────────────────
router.get('/releases', async (req, res) => {
  try {
    const { q, cat, count = '25', page = '1' } = req.query;

    // Build query string — prepend @cat if category filter provided
    let query = q || '';
    if (cat) query = `@cat ${cat} ${query}`.trim();

    const params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('count', count);
    params.set('page', page);

    const cacheKey = params.toString();
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    if (!canRequest()) {
      return res.status(429).json({ error: 'Rate limit — try again in a moment' });
    }

    logRequest();
    const apiRes = await fetch(`${API}/?${params}`);
    if (!apiRes.ok) throw new Error(`PreDB API: ${apiRes.status}`);
    const json = await apiRes.json();

    if (json.status !== 'success') throw new Error(json.message || 'PreDB error');

    const d = json.data;
    const result = {
      releases: (d.rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        team: r.team,
        cat: r.cat,
        size: formatSize(r.size),
        sizeMb: r.size,
        files: r.files,
        preAt: r.preAt,
        time: formatTime(r.preAt),
        nuke: r.nuke || null,
        media: r.media || null,
      })),
      total: d.total || d.rowCount || 0,
      page: Number(page),
      count: Number(count),
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/predb/stats ────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const hit = cached('stats');
    if (hit) return res.json(hit);

    if (!canRequest()) {
      return res.status(429).json({ error: 'Rate limit — try again in a moment' });
    }

    logRequest();
    const apiRes = await fetch(`${API}/stats`);
    if (!apiRes.ok) throw new Error(`PreDB stats: ${apiRes.status}`);
    const json = await apiRes.json();

    if (json.status !== 'success') throw new Error(json.message || 'PreDB error');

    const result = {
      total: json.data.total,
      today: json.data.today,
      week: json.data.week,
      month: json.data.month,
    };

    setCache('stats', result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
