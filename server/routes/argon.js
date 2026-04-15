/**
 * Argon Resellers — IPTV line management API proxy
 * All routes require admin auth. Proxies to distributors.argontv.nl.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import db from '../db/index.js';

const router = Router();
router.use(requireAdmin);

// ── Config helpers ──────────────────────────────────────────────────────────
const META_URL = 'argon_base_url';
const META_KEY = 'argon_api_key';
const DEFAULT_URL = 'https://distributors.argontv.nl';

function getMeta(key) {
  try {
    const row = db.prepare('SELECT value FROM iptv_meta WHERE key = ?').get(key);
    return row?.value || '';
  } catch { return ''; }
}

function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO iptv_meta (key, value) VALUES (?, ?)').run(key, value);
}

function getConfig() {
  return {
    baseUrl: getMeta(META_URL) || DEFAULT_URL,
    apiKey: getMeta(META_KEY),
  };
}

async function argonFetch(path, method = 'GET', body = null) {
  const { baseUrl, apiKey } = getConfig();
  if (!apiKey) throw new Error('Argon API key not configured');

  const url = `${baseUrl}${path}`;
  const opts = {
    method,
    headers: {
      'X-ApiKey': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ── Config endpoints ────────────────────────────────────────────────────────

// GET /api/argon/config — read config (masked key)
router.get('/config', (req, res) => {
  const { baseUrl, apiKey } = getConfig();
  res.json({
    baseUrl,
    hasKey: !!apiKey,
    maskedKey: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : '',
  });
});

// PUT /api/argon/config — save config
router.put('/config', (req, res) => {
  const { baseUrl, apiKey } = req.body;
  if (baseUrl != null) setMeta(META_URL, baseUrl.trim());
  if (apiKey != null && apiKey.trim()) setMeta(META_KEY, apiKey.trim());
  res.json({ ok: true });
});

// POST /api/argon/test — test connection
router.post('/test', async (req, res) => {
  try {
    const data = await argonFetch('/api/v1/balance');
    res.json({ success: true, balance: data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── Proxy endpoints — Lines ─────────────────────────────────────────────────

// GET /api/argon/balance
router.get('/balance', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/balance')); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// GET /api/argon/lines
router.get('/lines', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/lines')); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// GET /api/argon/lines/:id
router.get('/lines/:id', async (req, res) => {
  try { res.json(await argonFetch(`/api/v1/lines/${req.params.id}`)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// GET /api/argon/lines/:id/watching-now
router.get('/lines/:id/watching-now', async (req, res) => {
  try { res.json(await argonFetch(`/api/v1/lines/${req.params.id}/watching-now`)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/search
router.post('/lines/search', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/search-lines', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/create
router.post('/lines/create', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/create-line', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/:id/edit
router.post('/lines/:id/edit', async (req, res) => {
  try { res.json(await argonFetch(`/api/v1/lines/${req.params.id}/edit`, 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/suspend
router.post('/lines/suspend', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/suspend', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/activate
router.post('/lines/activate', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/activate', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/refund
router.post('/lines/refund', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/refund', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/auto-renew/enable
router.post('/lines/auto-renew/enable', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/enable-auto-renew', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/lines/auto-renew/disable
router.post('/lines/auto-renew/disable', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/disable-auto-renew', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// GET /api/argon/packages — list available packages/bouquets
router.get('/packages', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/packages')); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// ── Proxy endpoints — Templates ─────────────────────────────────────────────

// GET /api/argon/templates
router.get('/templates', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/templates')); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/templates/search
router.post('/templates/search', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/search-templates', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/argon/templates/delete
router.post('/templates/delete', async (req, res) => {
  try { res.json(await argonFetch('/api/v1/delete-templates', 'POST', req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

export default router;
