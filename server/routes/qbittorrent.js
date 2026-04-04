import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

let sessionCookie = null;

async function qbitLogin() {
  const url = process.env.QBIT_URL;
  const username = process.env.QBIT_USERNAME;
  const password = process.env.QBIT_PASSWORD;

  if (!url) throw new Error('qBittorrent URL not configured');

  const res = await fetch(`${url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });

  if (!res.ok) throw new Error('qBittorrent auth failed');
  const cookie = res.headers.get('set-cookie');
  if (cookie) sessionCookie = cookie.split(';')[0];
  return sessionCookie;
}

async function qbitFetch(path, options = {}) {
  const url = process.env.QBIT_URL;
  if (!sessionCookie) await qbitLogin();

  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: sessionCookie,
    },
  });

  // Re-auth if session expired
  if (res.status === 403) {
    await qbitLogin();
    return fetch(`${url}${path}`, {
      ...options,
      headers: { ...options.headers, Cookie: sessionCookie },
    });
  }

  return res;
}

// Test connection
router.get('/test', async (req, res) => {
  try {
    const url = process.env.QBIT_URL;
    if (!url) return res.json({ success: false, error: 'Not configured' });

    await qbitLogin();
    const version = await qbitFetch('/api/v2/app/version');
    const vText = await version.text();
    res.json({ success: true, version: vText });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// List torrents
router.get('/list', async (req, res) => {
  try {
    const result = await qbitFetch('/api/v2/torrents/info');
    const torrents = await result.json();
    const mapped = torrents.map((t) => ({
      id: t.hash,
      name: t.name,
      size: formatBytes(t.size),
      progress: Math.round(t.progress * 100),
      status: mapStatus(t.state),
      speed: formatBytes(t.dlspeed) + '/s',
      upSpeed: formatBytes(t.upspeed) + '/s',
      eta: t.eta === 8640000 ? '∞' : formatEta(t.eta),
      seeds: t.num_seeds,
      peers: t.num_leechs,
      added: new Date(t.added_on * 1000).toLocaleString(),
      savePath: t.save_path,
      ratio: Math.round((t.ratio || 0) * 100) / 100,
      rawDlSpeed: t.dlspeed || 0,
      rawUpSpeed: t.upspeed || 0,
    }));
    res.json({ torrents: mapped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add torrent
router.post('/add', async (req, res) => {
  try {
    const { url: torrentUrl, savePath } = req.body;
    const body = new URLSearchParams();
    body.append('urls', torrentUrl);
    if (savePath) body.append('savepath', savePath);

    const result = await qbitFetch('/api/v2/torrents/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    res.json({ success: result.ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause torrent
router.post('/pause', async (req, res) => {
  try {
    const { hash } = req.body;
    await qbitFetch('/api/v2/torrents/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume torrent
router.post('/resume', async (req, res) => {
  try {
    const { hash } = req.body;
    await qbitFetch('/api/v2/torrents/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete torrent
router.post('/delete', async (req, res) => {
  try {
    const { hash, deleteFiles } = req.body;
    await qbitFetch('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `hashes=${hash}&deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disk usage
router.get('/disk', async (req, res) => {
  try {
    const result = await qbitFetch('/api/v2/sync/maindata');
    const data = await result.json();
    const freeBytes = data.server_state?.free_space_on_disk || 0;
    const alloc = data.server_state?.alloc_frl || 0;
    // Also sum total size of all torrents for "used" estimate
    const torrents = Object.values(data.torrents || {});
    const usedBytes = torrents.reduce((sum, t) => sum + (t.size || 0), 0);
    res.json({
      freeBytes,
      usedBytes,
      totalBytes: freeBytes + usedBytes,
      free: formatBytes(freeBytes),
      used: formatBytes(usedBytes),
      total: formatBytes(freeBytes + usedBytes),
      pct: Math.round((usedBytes / (freeBytes + usedBytes || 1)) * 100),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapStatus(state) {
  const map = {
    downloading: 'downloading', forcedDL: 'downloading', stalledDL: 'downloading',
    uploading: 'seeding', forcedUP: 'seeding', stalledUP: 'completed',
    pausedDL: 'paused', pausedUP: 'paused',
    queuedDL: 'queued', queuedUP: 'queued',
    error: 'error', missingFiles: 'error',
    checkingDL: 'downloading', checkingUP: 'seeding',
  };
  return map[state] || 'queued';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatEta(seconds) {
  if (seconds <= 0) return 'Done';
  if (seconds > 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds > 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds > 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

export default router;
