import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────
const META_KEY_URL    = 'nordicbytes_url';
const META_KEY_APIKEY = 'nordicbytes_apikey';

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
    baseUrl: getMeta(META_KEY_URL) || 'https://nordicbytes.org',
    apiKey:  getMeta(META_KEY_APIKEY),
  };
}

async function nbFetch(path, params = {}) {
  const { baseUrl, apiKey } = getConfig();
  if (!apiKey) throw new Error('NordicBytes API key not configured');

  const url = new URL(path, baseUrl);
  // Append array params properly (categories[], types[], etc.)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item);
    } else {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NordicBytes API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── GET /api/nordicbytes/config — read saved config (key is masked) ─────────
router.get('/config', (req, res) => {
  try {
    const { baseUrl, apiKey } = getConfig();
    res.json({
      baseUrl,
      apiKey: apiKey ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : '',
      hasKey: !!apiKey,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/nordicbytes/config — save config ───────────────────────────────
router.put('/config', (req, res) => {
  try {
    const { baseUrl, apiKey } = req.body;
    if (baseUrl !== undefined) setMeta(META_KEY_URL, baseUrl.replace(/\/+$/, ''));
    if (apiKey !== undefined)  setMeta(META_KEY_APIKEY, apiKey);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/nordicbytes/test — test connectivity ──────────────────────────
router.post('/test', async (req, res) => {
  try {
    // Temporarily override config if body has values
    const origUrl = getMeta(META_KEY_URL);
    const origKey = getMeta(META_KEY_APIKEY);
    if (req.body.baseUrl) setMeta(META_KEY_URL, req.body.baseUrl.replace(/\/+$/, ''));
    if (req.body.apiKey)  setMeta(META_KEY_APIKEY, req.body.apiKey);

    try {
      const data = await nbFetch('/api/user');
      res.json({
        success: true,
        user: {
          username: data.data?.username || data.username || 'unknown',
          uploaded:  data.data?.uploaded  || data.uploaded,
          downloaded: data.data?.downloaded || data.downloaded,
          ratio: data.data?.ratio || data.ratio,
          seedbonus: data.data?.seedbonus || data.seedbonus,
        },
      });
    } catch (err) {
      // Restore original config on failure
      if (req.body.baseUrl) setMeta(META_KEY_URL, origUrl);
      if (req.body.apiKey)  setMeta(META_KEY_APIKEY, origKey);
      res.json({ success: false, error: err.message });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── GET /api/nordicbytes/user — get user profile/stats ──────────────────────
router.get('/user', async (req, res) => {
  try {
    const data = await nbFetch('/api/user');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/nordicbytes/torrents — search/filter torrents ──────────────────
router.get('/torrents', async (req, res) => {
  try {
    // Forward all query params to UNIT3D filter endpoint
    const params = { ...req.query };
    const data = await nbFetch('/api/torrents/filter', params);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/nordicbytes/torrents/latest — recent uploads ───────────────────
router.get('/torrents/latest', async (req, res) => {
  try {
    const perPage = req.query.perPage || 25;
    const data = await nbFetch('/api/torrents/filter', {
      sortField: 'created_at',
      sortDirection: 'desc',
      perPage,
      alive: 1,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/nordicbytes/torrents/:id — single torrent detail ───────────────
router.get('/torrents/:id', async (req, res) => {
  try {
    const data = await nbFetch(`/api/torrents/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/nordicbytes/torrents/:id/download — get .torrent and send to qBit
router.post('/torrents/:id/download', async (req, res) => {
  try {
    const { baseUrl, apiKey } = getConfig();
    if (!apiKey) return res.status(400).json({ error: 'API key not configured' });

    // First get the torrent details to get the download link
    const data = await nbFetch(`/api/torrents/${req.params.id}`);
    const torrent = data.data || data;
    const downloadUrl = torrent.attributes?.download_link || torrent.download_link;

    if (!downloadUrl) {
      return res.status(404).json({ error: 'No download link found for this torrent' });
    }

    // Make full URL if relative
    const fullUrl = downloadUrl.startsWith('http') ? downloadUrl : `${baseUrl}${downloadUrl}`;

    // If qBittorrent is configured, send it there
    if (req.body.sendToQbit) {
      const qbitUrl  = req.body.qbitUrl  || 'http://localhost:8080';
      const qbitUser = req.body.qbitUser || 'admin';
      const qbitPass = req.body.qbitPass || '';
      const savePath = req.body.savePath || '';

      // Login to qBittorrent
      const loginRes = await fetch(`${qbitUrl}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(qbitUser)}&password=${encodeURIComponent(qbitPass)}`,
      });
      const cookie = loginRes.headers.get('set-cookie');

      // Add torrent by URL
      const form = new URLSearchParams();
      form.append('urls', fullUrl);
      if (savePath) form.append('savepath', savePath);

      const addRes = await fetch(`${qbitUrl}/api/v2/torrents/add`, {
        method: 'POST',
        headers: { Cookie: cookie || '' },
        body: form,
      });

      if (addRes.ok) {
        res.json({ success: true, message: 'Torrent sent to qBittorrent', downloadUrl: fullUrl });
      } else {
        res.json({ success: false, error: 'qBittorrent rejected the torrent' });
      }
    } else {
      // Just return the download URL
      res.json({ success: true, downloadUrl: fullUrl });
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/nordicbytes/bookmarks/:id — bookmark a torrent ────────────────
router.post('/bookmarks/:id', async (req, res) => {
  try {
    const { baseUrl, apiKey } = getConfig();
    if (!apiKey) return res.status(400).json({ error: 'API key not configured' });

    const r = await fetch(`${baseUrl}/api/bookmarks/${req.params.id}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
