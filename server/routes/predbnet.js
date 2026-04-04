import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const API = 'https://api.predb.net';

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

// ── GET /api/predbnet/releases ──────────────────────────────────────────────
router.get('/releases', async (req, res) => {
  try {
    const { q, section, limit = '25', page = '1' } = req.query;

    const params = new URLSearchParams();
    let query = q || '';
    if (section) query = `${query} @section ${section}`.trim();
    if (query) params.set('q', query);
    params.set('limit', limit);
    params.set('page', page);

    const cacheKey = `releases:${params}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const apiRes = await fetch(`${API}/?${params}`);
    if (!apiRes.ok) throw new Error(`PreDB.net API: ${apiRes.status}`);
    const json = await apiRes.json();

    if (json.status !== 'success') throw new Error(json.message || 'PreDB.net error');

    const result = {
      releases: (json.data || []).map((r) => ({
        id: r.id,
        name: r.release,
        team: r.group,
        cat: r.section,
        size: formatSize(r.size),
        sizeMb: r.size,
        files: r.files,
        preAt: r.pretime,
        time: formatTime(r.pretime),
        nuke: r.status !== 0 ? { type: r.status === 1 ? 'NUKED' : 'UNNUKED', reason: r.reason } : null,
        genre: r.genre || null,
        url: r.url ? `https://predb.net${r.url}` : null,
        hasNfo: !!(r.nfo || r.nfo_img),
        nfoImg: r.nfo_img || null,
      })),
      total: json.results_total || json.results || 0,
      page: Number(page),
      count: Number(limit),
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/predbnet/nfo?name=Release.Name ─────────────────────────────────
router.get('/nfo', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name required' });

    const cacheKey = `nfo:${name}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const apiRes = await fetch(`${API}/nfo/${encodeURIComponent(name)}`);
    if (!apiRes.ok) {
      if (apiRes.status === 404) return res.json({ nfo: null });
      throw new Error(`NFO fetch: ${apiRes.status}`);
    }

    const contentType = apiRes.headers.get('content-type') || '';
    let result;

    if (contentType.includes('json')) {
      const json = await apiRes.json();
      if (json.status === 'error') return res.json({ nfo: null });
      result = { nfo: json.data || json.nfo || null };
    } else {
      const text = await apiRes.text();
      result = { nfo: text || null };
    }

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
