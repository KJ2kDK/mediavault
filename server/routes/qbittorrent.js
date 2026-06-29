import { Router, raw } from 'express';
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
      category: t.category || '',
      ratio: Math.round((t.ratio || 0) * 100) / 100,
      rawDlSpeed: t.dlspeed || 0,
      rawUpSpeed: t.upspeed || 0,
      // Raw numeric fields for client-side sorting
      rawSize: t.size || 0,
      rawAddedOn: t.added_on || 0,
      rawProgress: t.progress || 0,
      rawEta: t.eta || 0,
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

// Add torrent from an uploaded .torrent file. The browser POSTs the raw file
// bytes (application/octet-stream); we forward them to qBittorrent as the
// multipart `torrents` field, exactly like its Web UI's file upload. Built
// manually to avoid a multipart-parser dependency.
router.post('/add-file', raw({ type: 'application/octet-stream', limit: '25mb' }), async (req, res) => {
  try {
    const fileBuf = req.body;
    if (!Buffer.isBuffer(fileBuf) || fileBuf.length === 0) {
      return res.status(400).json({ error: 'No torrent file received' });
    }
    // Basic sanity: .torrent files are bencoded dictionaries starting with 'd'.
    if (fileBuf[0] !== 0x64 /* 'd' */) {
      return res.status(400).json({ error: 'Not a valid .torrent file' });
    }

    const rawName = (req.query.filename || 'upload.torrent').toString();
    const filename = rawName.replace(/["\r\n]/g, '').slice(0, 255);
    const savePath = req.query.savepath ? req.query.savepath.toString() : '';

    const boundary = `----MediaVault${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const parts = [
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="torrents"; filename="${filename}"\r\n` +
        `Content-Type: application/x-bittorrent\r\n\r\n`
      ),
      fileBuf,
      Buffer.from('\r\n'),
    ];
    if (savePath) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="savepath"\r\n\r\n${savePath}\r\n`
      ));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const result = await qbitFetch('/api/v2/torrents/add', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const text = (await result.text()).trim();
    // Success detection across qBittorrent versions:
    //  - Newer builds return JSON: { success_count, failure_count, ... }
    //  - Older builds return plain text: 'Ok.' / 'Fails.'
    let ok = result.ok;
    let detail = text;
    try {
      const json = JSON.parse(text);
      if (typeof json.success_count === 'number') {
        ok = ok && json.success_count > 0 && json.failure_count === 0;
        detail = `${json.failure_count} failed`;
      }
    } catch {
      // Plain-text response — 'Ok.' is success, anything matching 'fail' is not.
      ok = ok && !/fail/i.test(text);
    }
    if (!ok) {
      return res.status(400).json({ error: `qBittorrent rejected the file${detail ? `: ${detail}` : ''}` });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// qBittorrent 5.x renamed pause→stop and resume→start (the old paths 404).
// Try the modern path first, fall back to the legacy one for older servers.
async function qbitToggle(modernPath, legacyPath, hash) {
  const body = `hashes=${hash}`;
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
  let r = await qbitFetch(modernPath, opts);
  if (r.status === 404) r = await qbitFetch(legacyPath, opts);
  return r;
}

// Pause torrent (v5: stop)
router.post('/pause', async (req, res) => {
  try {
    await qbitToggle('/api/v2/torrents/stop', '/api/v2/torrents/pause', req.body.hash);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume torrent (v5: start)
router.post('/resume', async (req, res) => {
  try {
    await qbitToggle('/api/v2/torrents/start', '/api/v2/torrents/resume', req.body.hash);
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

export { qbitFetch };
export default router;
