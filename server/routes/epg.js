import { Router } from 'express';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import db from '../db/index.js';
import { dbLog } from './logs.js';

const router = Router();

// In-memory job state for background fetch
let fetchJob = null; // { status, started, finished, count, error }
let suppJob  = null; // for supplemental URL fetches

// Parse XMLTV timestamp → unix epoch seconds
// Format: "20240403120000 +0000" or "20240403120000 +0100"
function parseXmltvTime(ts) {
  if (!ts) return 0;
  const s = String(ts).trim();
  const year  = s.slice(0, 4);
  const month = s.slice(4, 6);
  const day   = s.slice(6, 8);
  const hour  = s.slice(8, 10);
  const min   = s.slice(10, 12);
  const sec   = s.slice(12, 14);
  // Offset: "+0100" → "+01:00"
  const raw = s.slice(15) || '+0000';
  const tz  = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return Math.floor(new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}${tz}`).getTime() / 1000);
}

// Extract plain string from xml2js title/desc node (may be string or {_: ..., $: ...})
function textOf(node) {
  if (!node) return null;
  const n = Array.isArray(node) ? node[0] : node;
  if (typeof n === 'string') return n;
  return n?._ ?? String(n) ?? null;
}

async function fetchAndStoreEpg(base, user, pass) {
  const url = `${base}/xmltv.php?username=${user}&password=${pass}`;
  return fetchXmltvUrl(url, false);
}

// Fetch any XMLTV URL. merge=true means INSERT OR REPLACE without DELETE first.
async function fetchXmltvUrl(url, merge = false) {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000); // 3 min max

  let xml;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from XMLTV endpoint`);

    const isGzip = url.endsWith('.gz') || (res.headers.get('content-encoding') || '').includes('gzip')
      || (res.headers.get('content-type') || '').includes('gzip');

    if (isGzip) {
      const chunks = [];
      const collector = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
      });
      await pipeline(res.body, createGunzip(), collector);
      xml = Buffer.concat(chunks).toString('utf8');
    } else {
      xml = await res.text();
    }
  } finally {
    clearTimeout(timer);
  }

  const parsed = await parseStringPromise(xml, { explicitArray: true, trim: true });
  const programmes = parsed?.tv?.programme ?? [];

  const nowSec  = Math.floor(Date.now() / 1000);
  const cutoff  = nowSec - 3600; // discard programmes already over for more than 1 hour

  const insert = db.prepare(`
    INSERT OR REPLACE INTO epg_programmes (channel_id, title, start, stop, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((progs) => {
    if (!merge) db.prepare('DELETE FROM epg_programmes').run();
    let stored = 0;
    for (const p of progs) {
      const channelId = p?.$?.channel;
      const start     = parseXmltvTime(p?.$?.start);
      const stop      = parseXmltvTime(p?.$?.stop);
      if (!channelId || !start || !stop || stop < cutoff) continue;
      const title = textOf(p.title) ?? 'Unknown';
      const desc  = textOf(p.desc) ?? null;
      insert.run(channelId, title, start, stop, desc);
      stored++;
    }
    return stored;
  });

  const stored = insertAll(programmes);
  db.prepare("INSERT OR REPLACE INTO epg_meta (key, value) VALUES ('last_fetch_at', ?)")
    .run(String(Math.floor(Date.now() / 1000)));

  return stored;
}

// ── GET /api/epg/status ───────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  try {
    const meta  = db.prepare("SELECT value FROM epg_meta WHERE key = 'last_fetch_at'").get();
    const count = db.prepare('SELECT COUNT(*) AS n FROM epg_programmes').get();
    res.json({ fetched_at: meta ? Number(meta.value) : null, count: count.n, job: fetchJob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/epg/fetch ───────────────────────────────────────────────────────
// Body: { base, user, pass }  — starts background fetch, returns immediately
router.post('/fetch', (req, res) => {
  if (fetchJob?.status === 'running') {
    return res.json({ status: 'running', started: fetchJob.started });
  }
  const { base, user, pass } = req.body;
  if (!base || !user || !pass) return res.status(400).json({ error: 'Credentials required' });

  const cleanBase = base.replace(/\/$/, '');
  fetchJob = { status: 'running', started: Date.now() };

  fetchAndStoreEpg(cleanBase, user, pass)
    .then((count) => { fetchJob = { status: 'done', count, finished: Date.now() }; })
    .catch((err)  => {
      fetchJob = { status: 'error', error: err.message, finished: Date.now() };
      dbLog('error', 'epg/fetch', err.message, { stack: err.stack });
    });

  res.json({ status: 'started' });
});

// ── GET /api/epg/now?ids=epgId1,epgId2 ───────────────────────────────────────
// Returns current + next programme for each requested EPG channel ID
router.get('/now', (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').filter(Boolean);
    if (!ids.length) return res.json({ epg: {} });

    const nowSec = Math.floor(Date.now() / 1000);

    // Single query for all requested IDs, ordered so we can pick first two per channel
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT channel_id, title, start, stop, description
      FROM   epg_programmes
      WHERE  channel_id IN (${placeholders}) AND stop > ?
      ORDER  BY channel_id, start ASC
    `).all(...ids, nowSec);

    // Group into now/next per channel
    const epg = {};
    for (const id of ids) epg[id] = { now: null, next: null };
    for (const row of rows) {
      const slot = epg[row.channel_id];
      if (!slot) continue;
      if (!slot.now) slot.now = row;
      else if (!slot.next) slot.next = row;
    }

    // For any ids with no data, try case-insensitive fallback (provider epg_id casing may differ)
    const missing = ids.filter((id) => !epg[id].now);
    if (missing.length) {
      for (const id of missing) {
        const ciRows = db.prepare(`
          SELECT channel_id, title, start, stop, description
          FROM   epg_programmes
          WHERE  lower(channel_id) = lower(?) AND stop > ?
          ORDER  BY start ASC LIMIT 2
        `).all(id, nowSec);
        if (ciRows.length) {
          epg[id].now = ciRows[0];
          if (ciRows[1]) epg[id].next = ciRows[1];
        }
      }
    }

    res.json({ epg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/epg/fetch-url — fetch a raw XMLTV URL and merge into existing data
// Body: { url }  — starts background fetch, returns immediately
router.post('/fetch-url', (req, res) => {
  if (suppJob?.status === 'running') {
    return res.json({ status: 'running', started: suppJob.started });
  }
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  suppJob = { status: 'running', started: Date.now(), url };

  fetchXmltvUrl(url, true)
    .then((count) => { suppJob = { status: 'done', count, finished: Date.now(), url }; })
    .catch((err) => {
      suppJob = { status: 'error', error: err.message, finished: Date.now(), url };
      dbLog('error', 'epg/fetch-url', err.message, { stack: err.stack });
    });

  res.json({ status: 'started' });
});

// ── GET /api/epg/supp/status ──────────────────────────────────────────────────
router.get('/supp/status', (_req, res) => {
  res.json({ job: suppJob });
});

// ── GET /api/epg/schedule?id=epgChannelId ────────────────────────────────────
// Returns up to 24 h of schedule for a single channel
router.get('/schedule', (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const nowSec = Math.floor(Date.now() / 1000);
    let programmes = db.prepare(`
      SELECT channel_id, title, start, stop, description
      FROM   epg_programmes
      WHERE  channel_id = ? AND stop > ? AND start < ?
      ORDER  BY start ASC
    `).all(id, nowSec - 3600, nowSec + 86400);

    // Fallback: case-insensitive match if exact match yields nothing
    if (!programmes.length) {
      programmes = db.prepare(`
        SELECT channel_id, title, start, stop, description
        FROM   epg_programmes
        WHERE  lower(channel_id) = lower(?) AND stop > ? AND start < ?
        ORDER  BY start ASC
      `).all(id, nowSec - 3600, nowSec + 86400);
    }

    res.json({ programmes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/epg/schedules?ids=id1,id2,... ───────────────────────────────────
// Batch version of /schedule — one SQL query for multiple channel IDs
router.get('/schedules', (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });

    const nowSec = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const programmes = db.prepare(`
      SELECT channel_id, title, start, stop, description
      FROM   epg_programmes
      WHERE  channel_id IN (${placeholders})
        AND  stop  > ?
        AND  start < ?
      ORDER  BY channel_id, start ASC
    `).all(...ids, nowSec - 3600, nowSec + 86400);

    res.json({ programmes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
