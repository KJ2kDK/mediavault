import { Router } from 'express';
import { dbLog } from './logs.js';
import db from '../db/index.js';
// Use Node 20's built-in fetch (undici) for better DNS + connection pooling
// under concurrent IPTV stream load. node-fetch v3 had repeated ENOTFOUND
// races even with /etc/hosts pinned.

const router = Router();

// ── In-memory sync job state ──────────────────────────────────────────────────
let syncJob = null; // { status, started, finished, count, error }

// ── Persist a channel list to the DB ─────────────────────────────────────────
// Preserves any manually-matched epg_ids that Xtream doesn't supply — so
// auto-match results survive daily syncs.
function persistChannels(channels, source) {
  // Snapshot existing epg_id assignments before wiping
  const savedEpgIds = {};
  db.prepare('SELECT id, epg_id FROM iptv_channels WHERE epg_id IS NOT NULL').all()
    .forEach((r) => { savedEpgIds[r.id] = r.epg_id; });

  const insert = db.prepare(`
    INSERT OR REPLACE INTO iptv_channels (id, name, group_name, logo, url, epg_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const clearAndInsert = db.transaction((chs) => {
    db.prepare('DELETE FROM iptv_channels').run();
    for (const ch of chs) {
      // Prefer provider-supplied epg_id; fall back to previously auto-matched id
      const epgId = ch.epg_id || savedEpgIds[ch.id] || null;
      insert.run(ch.id, ch.name, ch.group ?? null, ch.logo ?? null, ch.url ?? null, epgId, source);
    }
    return chs.length;
  });
  const count = clearAndInsert(channels);
  db.prepare("INSERT OR REPLACE INTO iptv_meta (key, value) VALUES ('last_sync_at', ?)")
    .run(String(Math.floor(Date.now() / 1000)));
  return count;
}

// ── Map a DB row back to the frontend channel shape ───────────────────────────
function rowToChannel(row) {
  return { id: row.id, name: row.name, group: row.group_name, logo: row.logo, url: row.url, epg_id: row.epg_id };
}

// ── Background sync from stored Xtream creds ──────────────────────────────────
async function runXtreamSync(cleanBase, user, pass) {
  const [liveRes, catRes] = await Promise.all([
    fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_live_streams`),
    fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_live_categories`),
  ]);
  const [liveStreams, categories] = await Promise.all([liveRes.json(), catRes.json()]);

  const catMap = {};
  if (Array.isArray(categories)) categories.forEach((c) => { catMap[c.category_id] = c.category_name; });

  const channels = (Array.isArray(liveStreams) ? liveStreams : []).map((s, i) => ({
    id: `xtream_${s.stream_id || i}`,
    name: s.name || 'Unknown',
    group: catMap[s.category_id] || 'Uncategorized',
    logo: s.stream_icon || null,
    url: `${cleanBase}/live/${user}/${pass}/${s.stream_id}.m3u8`,
    epg_id: s.epg_channel_id || null,
  }));

  const count = persistChannels(channels, 'xtream');
  return { channels, count };
}

// Fetch and parse M3U from URL
router.get('/m3u', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const response = await fetch(url);
    const text = await response.text();
    const channels = parseM3U(text);
    res.json({ channels, count: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect to Xtream Codes API — fetches live channels and persists to DB
router.post('/xtream', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    if (!base || !user || !pass) {
      return res.status(400).json({ error: 'All credentials required' });
    }
    const cleanBase = base.replace(/\/$/, '');
    const { channels } = await runXtreamSync(cleanBase, user, pass);

    // Store credentials for server-side auto-refresh
    db.prepare("INSERT OR REPLACE INTO iptv_meta (key, value) VALUES ('xtream_creds', ?)")
      .run(JSON.stringify({ base: cleanBase, user, pass }));

    res.json({ channels, count: channels.length });
  } catch (err) {
    dbLog('error', 'iptv/xtream', err.message, { stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/iptv/epg-match — auto-match channels to EPG by name ─────────────
// Strips country prefixes / quality tags from channel names, then looks for a
// matching channel_id in the EPG database.
router.post('/epg-match', (req, res) => {
  try {
    // Build lookup: normalised_name → epg_channel_id
    const epgIds = db.prepare('SELECT DISTINCT channel_id FROM epg_programmes').all().map(r => r.channel_id);

    function normalise(str) {
      return str
        .replace(/^[^a-zA-Z0-9]*[A-Z]{2,3}[^a-zA-Z0-9]+/i, '') // strip "DK| ", "[DK] ", "✶DK|" etc.
        .replace(/\s*\[[^\]]*\]/g, '')   // strip [720p], [HD], [BK], [1080p]
        .replace(/\s*\([^)]*\)/g, '')    // strip (backup), (alt)
        .replace(/\s*(UHD|FHD|HD|SD|BK)\s*$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');     // keep only alphanumeric → "tv2syd"
    }

    // Build reverse map: normalised_channel_id → original channel_id
    // Normalise IDs: lowercase + alphanumeric only ("BBC.Earth.dk" → "bbcearthdk")
    const normId = (id) => id.toLowerCase().replace(/[^a-z0-9]/g, '');
    const epgMap = {};
    for (const id of epgIds) {
      const full = normId(id);                      // "bbcearthdk"
      if (!epgMap[full]) epgMap[full] = id;
      // Also index by name prefix only (before first dot): "bbc"
      const prefix = normId(id.split('.')[0]);
      if (!epgMap[prefix]) epgMap[prefix] = id;
    }

    // Build set of valid EPG channel_ids for fast lookup
    const validEpgIdSet = new Set(epgIds);

    // Match channels that either have no epg_id OR have one that doesn't exist in actual EPG data
    // (provider-supplied epg_channel_id often doesn't match the XMLTV channel_id format)
    const candidates = db.prepare("SELECT id, name, epg_id FROM iptv_channels").all()
      .filter(r => !r.epg_id || !validEpgIdSet.has(r.epg_id));
    const update = db.prepare("UPDATE iptv_channels SET epg_id = ? WHERE id = ?");

    let matched = 0;
    let rematched = 0;
    const matchLog = [];

    for (const ch of candidates) {
      // If provider gave an epg_id, try case-insensitive / normalised lookup first
      if (ch.epg_id) {
        const normProvided = normId(ch.epg_id);
        if (epgMap[normProvided]) {
          update.run(epgMap[normProvided], ch.id);
          rematched++;
          if (matchLog.length < 30) matchLog.push({ channel: ch.name, epg_id: epgMap[normProvided], was: ch.epg_id });
          continue;
        }
      }
      // Skip separator / placeholder channels
      if (/[✶⋆★•·►▶◄◀]/u.test(ch.name)) continue;
      const norm = normalise(ch.name);
      if (norm.length < 2) continue; // skip if name normalises to single char or empty

      // Try exact match, then progressively shorter prefixes
      let found = epgMap[norm] ?? null;

      // Try appending TLDs — prioritise the country detected from channel name prefix
      const PREFIX_TO_TLD = {
        DNK:'dk', DK:'dk', SWE:'se', SE:'se', NOR:'no', NO:'no', FIN:'fi', FI:'fi',
        UK:'uk', GB:'uk', US:'us', USA:'us', DE:'de', NL:'nl', FR:'fr', ES:'es',
        IT:'it', CA:'ca', CAN:'ca', AU:'au', PT:'pt', PL:'pl', RO:'ro', HU:'hu',
        AT:'at', CH:'ch', BE:'be', IE:'ie', CZ:'cz', SK:'sk', HR:'hr', RS:'rs',
        BG:'bg', GR:'gr', TR:'tr', RU:'ru', IN:'in', JP:'jp', KR:'kr', BR:'br',
        MX:'mx', AR:'ar', CL:'cl', CO:'co', IL:'il', ZA:'za',
      };
      const prefixMatch = ch.name.match(/^([A-Z]{2,3})\|/i);
      const detectedTld = prefixMatch ? PREFIX_TO_TLD[prefixMatch[1].toUpperCase()] : null;
      const tlds = detectedTld
        ? [detectedTld, ...['dk','se','no','fi','uk','us','de','nl','fr','es','it','ca','au'].filter(t => t !== detectedTld)]
        : ['dk', 'se', 'no', 'fi', 'uk', 'us', 'de', 'nl', 'fr', 'es', 'it', 'ca', 'au'];
      if (!found) {
        for (const tld of tlds) {
          const candidate = norm + tld;  // "bbcearth" + "dk" = "bbcearthdk"
          if (epgMap[candidate]) { found = epgMap[candidate]; break; }
        }
      }

      // Fallback: strip digits from norm and retry (handles "tv2syd" → "tvsyd" → "tvsyddk")
      if (!found) {
        const normNoDigits = norm.replace(/\d/g, '');
        if (normNoDigits.length >= 3 && normNoDigits !== norm) {
          found = epgMap[normNoDigits] ?? null;
          if (!found) {
            for (const tld of tlds) {
              const candidate = normNoDigits + tld;
              if (epgMap[candidate]) { found = epgMap[candidate]; break; }
            }
          }
        }
      }

      if (found) {
        update.run(found, ch.id);
        matched++;
        if (matchLog.length < 20) matchLog.push({ channel: ch.name, epg_id: found });
      }
    }

    dbLog('info', 'iptv/epg-match', `Auto-matched ${matched} new + ${rematched} re-matched from ${candidates.length} candidates`);
    res.json({ matched, rematched, total_candidates: candidates.length, examples: matchLog });
  } catch (err) {
    dbLog('error', 'iptv/epg-match', err.message, { stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/iptv/preload — return all cached channels from DB ────────────────
router.get('/preload', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM iptv_channels ORDER BY group_name, name').all();
    const meta = db.prepare("SELECT value FROM iptv_meta WHERE key='last_sync_at'").get();
    const lastSyncAt = meta ? Number(meta.value) : null;
    const age = lastSyncAt ? Math.floor(Date.now() / 1000) - lastSyncAt : Infinity;
    const stale = age > 86400; // 24 hours

    // Auto-trigger background refresh if data is stale and creds are stored
    if (stale && rows.length > 0 && syncJob?.status !== 'running') {
      const credsMeta = db.prepare("SELECT value FROM iptv_meta WHERE key='xtream_creds'").get();
      if (credsMeta) {
        const creds = JSON.parse(credsMeta.value);
        syncJob = { status: 'running', started: Date.now(), trigger: 'auto' };
        runXtreamSync(creds.base, creds.user, creds.pass)
          .then(({ count }) => { syncJob = { status: 'done', count, finished: Date.now() }; })
          .catch((err) => {
            syncJob = { status: 'error', error: err.message, finished: Date.now() };
            dbLog('error', 'iptv/auto-sync', err.message, { stack: err.stack });
          });
      }
    }

    res.json({
      channels: rows.map(rowToChannel),
      count: rows.length,
      last_sync_at: lastSyncAt,
      stale,
      sync: syncJob,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/iptv/sync/status ─────────────────────────────────────────────────
router.get('/sync/status', (_req, res) => {
  try {
    const meta   = db.prepare("SELECT value FROM iptv_meta WHERE key='last_sync_at'").get();
    const count  = db.prepare('SELECT COUNT(*) AS n FROM iptv_channels').get();
    const lastSyncAt = meta ? Number(meta.value) : null;
    const age = lastSyncAt ? Math.floor(Date.now() / 1000) - lastSyncAt : Infinity;
    res.json({ count: count.n, last_sync_at: lastSyncAt, stale: age > 86400, sync: syncJob });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/iptv/sync — manually trigger a background re-sync ───────────────
router.post('/sync', (req, res) => {
  if (syncJob?.status === 'running') {
    return res.json({ status: 'running', started: syncJob.started });
  }
  // Use body creds if provided, otherwise fall back to stored creds
  let creds = req.body?.base ? req.body : null;
  if (!creds) {
    const stored = db.prepare("SELECT value FROM iptv_meta WHERE key='xtream_creds'").get();
    if (stored) creds = JSON.parse(stored.value);
  }
  if (!creds?.base) return res.status(400).json({ error: 'No credentials available. Connect Xtream first.' });

  // Persist new creds if provided in body
  if (req.body?.base) {
    db.prepare("INSERT OR REPLACE INTO iptv_meta (key, value) VALUES ('xtream_creds', ?)")
      .run(JSON.stringify({ base: creds.base, user: creds.user, pass: creds.pass }));
  }

  syncJob = { status: 'running', started: Date.now(), trigger: 'manual' };
  runXtreamSync(creds.base, creds.user, creds.pass)
    .then(({ count }) => { syncJob = { status: 'done', count, finished: Date.now() }; })
    .catch((err) => {
      syncJob = { status: 'error', error: err.message, finished: Date.now() };
      dbLog('error', 'iptv/sync', err.message, { stack: err.stack });
    });

  res.json({ status: 'started' });
});

// List VOD categories (fast — no stream data)
router.post('/xtream/vod/categories', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const catRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_vod_categories`);
    const categories = await catRes.json();
    const cats = (Array.isArray(categories) ? categories : []).map((c) => ({
      id: String(c.category_id),
      name: c.category_name || 'Uncategorized',
    }));

    // Extract country from category name and store in DB
    const countryRegex = /^\[([A-Z]{2,3})\]\s*|^\|([A-Z]{2,3})\|\s*|^([A-Z]{2,3})\s*[:|\-]\s*/i;
    const insertCat = db.prepare(`
      INSERT OR REPLACE INTO vod_categories (id, name, country, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    const tx = db.transaction(() => {
      for (const cat of cats) {
        const m = cat.name.match(countryRegex);
        const country = m ? (m[1] || m[2] || m[3]) : null;
        insertCat.run(cat.id, cat.name, country);
      }
    });
    tx();

    res.json({ categories: cats, count: cats.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Xtream VOD — supports optional category_id for per-category loading
router.post('/xtream/vod', async (req, res) => {
  try {
    const { base, user, pass, category_id } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const action = category_id
      ? `get_vod_streams&category_id=${encodeURIComponent(category_id)}`
      : 'get_vod_streams';
    const vodRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=${action}`);
    const vodStreams = await vodRes.json();

    const items = (Array.isArray(vodStreams) ? vodStreams : []).map((v, i) => ({
      id: `vod_${v.stream_id || i}`,
      title: v.name || 'Unknown',
      type: 'movie',
      year: v.year || null,
      rating: v.rating_5based ? String(Math.round(v.rating_5based * 2 * 10) / 10) : (v.rating || null),
      genre: v.genre || '',
      category_id: v.category_id ? String(v.category_id) : null,
      thumb: v.stream_icon || null,
      url: `${cleanBase}/movie/${user}/${pass}/${v.stream_id}.mkv`,
    }));

    // Store items in DB
    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO vod_items (id, title, type, year, rating, genre, category_id, thumb, url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const tx = db.transaction(() => {
      for (const item of items) {
        insertItem.run(item.id, item.title, item.type, item.year, item.rating, item.genre, item.category_id, item.thumb, item.url);
      }
    });
    tx();

    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Series categories (fast)
router.post('/xtream/series/categories', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const catRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_series_categories`);
    const categories = await catRes.json();
    const cats = (Array.isArray(categories) ? categories : []).map((c) => ({
      id: String(c.category_id),
      name: c.category_name || 'Uncategorized',
    }));

    // Extract country from category name and store in DB
    const countryRegex = /^\[([A-Z]{2,3})\]\s*|^\|([A-Z]{2,3})\|\s*|^([A-Z]{2,3})\s*[:|\-]\s*/i;
    const insertCat = db.prepare(`
      INSERT OR REPLACE INTO series_categories (id, name, country, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    const tx = db.transaction(() => {
      for (const cat of cats) {
        const m = cat.name.match(countryRegex);
        const country = m ? (m[1] || m[2] || m[3]) : null;
        insertCat.run(cat.id, cat.name, country);
      }
    });
    tx();

    res.json({ categories: cats, count: cats.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Xtream Series — supports optional category_id
router.post('/xtream/series', async (req, res) => {
  try {
    const { base, user, pass, category_id } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const action = category_id
      ? `get_series&category_id=${encodeURIComponent(category_id)}`
      : 'get_series';
    const seriesRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=${action}`);
    const series = await seriesRes.json();

    const items = (Array.isArray(series) ? series : []).map((s, i) => ({
      id: `series_${s.series_id || i}`,
      title: s.name || 'Unknown',
      type: 'show',
      year: s.year || null,
      rating: s.rating || null,
      genre: s.genre || '',
      category_id: s.category_id ? String(s.category_id) : null,
      thumb: s.cover || null,
    }));

    // Store items in DB
    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO series_items (id, title, type, year, rating, genre, category_id, thumb, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const tx = db.transaction(() => {
      for (const item of items) {
        insertItem.run(item.id, item.title, item.type, item.year, item.rating, item.genre, item.category_id, item.thumb);
      }
    });
    tx();

    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch with retry — handles transient DNS failures from CDN wildcard subdomains
// IPTV CDN domains (cdn77-e6f7e5.zaypool.win) have broken-SOA DNS that
// libc getaddrinfo (used by undici's default lookup) refuses but
// dns.resolve4 accepts. We give undici a custom lookup that:
//   1. tries getaddrinfo first (fast)
//   2. falls back to dns.resolve4 on ENOTFOUND
// undici sets the Host header itself based on the URL — so by lying to it
// in lookup() (returning the IP for the original hostname) we keep the
// correct Host header automatically. This was the bug with the old
// IP-rewrite-with-custom-Host approach: fetch ignores caller-set Host.
import dnsModule, { promises as dns } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

const dnsCache = new Map(); // hostname → { ip, expires }
const DNS_TTL = 60_000;

// undici v6 calls lookup with {all: true}, expecting cb(err, [{address, family}, ...])
function resolveLookup(hostname, opts, cb) {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cb(null, [{ address: cached.ip, family: 4 }]);
  }

  // Try fast libc lookup first
  dnsModule.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (!err && addresses?.length) {
      dnsCache.set(hostname, { ip: addresses[0].address, expires: Date.now() + DNS_TTL });
      return cb(null, addresses);
    }
    // Fallback to pure resolve4 (works for broken-SOA CDN hosts)
    dns.resolve4(hostname).then((addrs) => {
      if (!addrs.length) return cb(new Error(`No A record for ${hostname}`));
      dnsCache.set(hostname, { ip: addrs[0], expires: Date.now() + DNS_TTL });
      console.log(`[proxy] DNS fallback: ${hostname} → ${addrs[0]}`);
      cb(null, addrs.map((a) => ({ address: a, family: 4 })));
    }).catch(cb);
  });
}

const proxyAgent = new Agent({
  connect: { lookup: resolveLookup },
  headersTimeout: 10_000,
  bodyTimeout: 30_000,
});

function isDnsError(err) {
  const code = err.cause?.code || err.code;
  const msg = err.cause?.message || err.message || '';
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN');
}

async function fetchWithRetry(url, opts = {}, retries = 5, delay = 200) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await undiciFetch(url, { ...opts, dispatcher: proxyAgent });
    } catch (err) {
      lastErr = err;
      const dnsErr = isDnsError(err);
      const isNetwork = err.cause?.code === 'ECONNRESET' || err.cause?.code === 'ETIMEDOUT' || err.cause?.code === 'ECONNREFUSED';
      if ((dnsErr || isNetwork) && attempt < retries) {
        if (attempt === 1) console.log(`[proxy] retry 1/${retries} (${err.cause?.code || err.code || 'DNS'}) for ${url.slice(0, 80)}...`);
        await new Promise((r) => setTimeout(r, delay * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Stream proxy — fetches manifests/segments server-side to bypass browser CORS restrictions
// Uses arrayBuffer() for node-fetch v3 compatibility (v3 uses Web Streams, not Node streams)
router.get('/proxy', async (req, res) => {
  const { url, token } = req.query;
  if (!url) return res.status(400).end('url required');
  // Carry the JWT token through to rewritten segment URLs so HLS.js stays authenticated
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';

  try {
    const upstream = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 VLC/3.0' },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).end(`Upstream error: ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isManifest =
      url.toLowerCase().includes('.m3u8') ||
      contentType.toLowerCase().includes('mpegurl');

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (isManifest) {
      const text = await upstream.text();
      // upstream.url is set by undici to the final URL after redirects,
      // which preserves the original hostname (not an IP) because our
      // custom dispatcher hands undici an IP via lookup() but the URL
      // and Host header stay original.
      const finalUrl = upstream.url || url;
      console.log('[proxy] manifest base url:', finalUrl);

      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          try {
            const absUrl = new URL(trimmed, finalUrl).toString();
            return `/api/iptv/proxy?url=${encodeURIComponent(absUrl)}${tokenParam}`;
          } catch {
            return line;
          }
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Binary segment — log and buffer
    console.log('[proxy] segment', upstream.status, url.slice(-60));
    if (!upstream.ok) {
      return res.status(upstream.status).end(`Upstream error: ${upstream.status}`);
    }
    const buf = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType || 'video/mp2t');
    res.end(Buffer.from(buf));
  } catch (err) {
    dbLog('error', 'iptv/proxy', err.message, { stack: err.stack, context: { url: url?.slice(-120) } });
    res.status(502).end(`Proxy error: ${err.message}`);
  }
});

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const nameMatch = trimmed.match(/,(.+)$/);
      const groupMatch = trimmed.match(/group-title="([^"]*?)"/);
      const logoMatch = trimmed.match(/tvg-logo="([^"]*?)"/);
      const idMatch = trimmed.match(/tvg-id="([^"]*?)"/);
      current = {
        id: `m3u_${channels.length}`,
        tvgId: idMatch ? idMatch[1] : '',
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        logo: logoMatch ? logoMatch[1] : null,
        url: '',
      };
    } else if (trimmed && !trimmed.startsWith('#') && current) {
      current.url = trimmed;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

// ── GET /api/iptv/xtream/vod/categories/cached — serve VOD categories from DB ────
router.get('/xtream/vod/categories/cached', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name FROM vod_categories ORDER BY name').all();
    const categories = rows.map(r => ({ id: r.id, name: r.name }));
    res.json({ categories, count: categories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/iptv/xtream/vod/cached — serve VOD items from DB for a category ───
router.get('/xtream/vod/cached', (req, res) => {
  try {
    const { category_id } = req.query;
    let query = 'SELECT id, title, type, year, rating, genre, category_id, thumb, url FROM vod_items';
    if (category_id) {
      query += ` WHERE category_id = ?`;
      const rows = db.prepare(query).all(category_id);
      res.json({ items: rows, count: rows.length });
    } else {
      const rows = db.prepare(query).all();
      res.json({ items: rows, count: rows.length });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/iptv/xtream/series/categories/cached — serve Series categories from DB ──
router.get('/xtream/series/categories/cached', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, name FROM series_categories ORDER BY name').all();
    const categories = rows.map(r => ({ id: r.id, name: r.name }));
    res.json({ categories, count: categories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/iptv/xtream/series/cached — serve Series items from DB for a category ──
router.get('/xtream/series/cached', (req, res) => {
  try {
    const { category_id } = req.query;
    let query = 'SELECT id, title, type, year, rating, genre, category_id, thumb FROM series_items';
    if (category_id) {
      query += ` WHERE category_id = ?`;
      const rows = db.prepare(query).all(category_id);
      res.json({ items: rows, count: rows.length });
    } else {
      const rows = db.prepare(query).all();
      res.json({ items: rows, count: rows.length });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/iptv/vod-series/sync — background sync for VOD and Series ─────────
router.post('/vod-series/sync', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    if (!base || !user || !pass) {
      return res.status(400).json({ error: 'All credentials required' });
    }
    const cleanBase = base.replace(/\/$/, '');

    // Fetch VOD categories and items
    const vodCatRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_vod_categories`);
    const vodCats = await vodCatRes.json();
    const vodCategories = (Array.isArray(vodCats) ? vodCats : []).map(c => ({
      id: String(c.category_id),
      name: c.category_name || 'Uncategorized',
    }));

    // Fetch VOD items for each category
    const countryRegex = /^\[([A-Z]{2,3})\]\s*|^\|([A-Z]{2,3})\|\s*|^([A-Z]{2,3})\s*[:|\-]\s*/i;
    const allVodItems = [];
    const insertVodCat = db.prepare(`
      INSERT OR REPLACE INTO vod_categories (id, name, country, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    const insertVodItem = db.prepare(`
      INSERT OR REPLACE INTO vod_items (id, title, type, year, rating, genre, category_id, thumb, url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const vodTx = db.transaction(() => {
      for (const cat of vodCategories) {
        const m = cat.name.match(countryRegex);
        const country = m ? (m[1] || m[2] || m[3]) : null;
        insertVodCat.run(cat.id, cat.name, country);
      }
    });
    vodTx();

    for (const cat of vodCategories) {
      try {
        const itemRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_vod_streams&category_id=${encodeURIComponent(cat.id)}`);
        const itemData = await itemRes.json();
        const items = (Array.isArray(itemData) ? itemData : []).map((v, i) => ({
          id: `vod_${v.stream_id || i}`,
          title: v.name || 'Unknown',
          type: 'movie',
          year: v.year || null,
          rating: v.rating_5based ? String(Math.round(v.rating_5based * 2 * 10) / 10) : (v.rating || null),
          genre: v.genre || '',
          category_id: String(v.category_id || cat.id),
          thumb: v.stream_icon || null,
          url: `${cleanBase}/movie/${user}/${pass}/${v.stream_id}.mkv`,
        }));
        allVodItems.push(...items);

        const vodItemTx = db.transaction(() => {
          for (const item of items) {
            insertVodItem.run(item.id, item.title, item.type, item.year, item.rating, item.genre, item.category_id, item.thumb, item.url);
          }
        });
        vodItemTx();
      } catch (e) {
        console.error(`Failed to fetch VOD items for category ${cat.id}:`, e.message);
      }
    }

    // Fetch Series categories and items
    const seriesCatRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_series_categories`);
    const seriesCats = await seriesCatRes.json();
    const seriesCategories = (Array.isArray(seriesCats) ? seriesCats : []).map(c => ({
      id: String(c.category_id),
      name: c.category_name || 'Uncategorized',
    }));

    const allSeriesItems = [];
    const insertSeriesCat = db.prepare(`
      INSERT OR REPLACE INTO series_categories (id, name, country, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    const insertSeriesItem = db.prepare(`
      INSERT OR REPLACE INTO series_items (id, title, type, year, rating, genre, category_id, thumb, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const seriesTx = db.transaction(() => {
      for (const cat of seriesCategories) {
        const m = cat.name.match(countryRegex);
        const country = m ? (m[1] || m[2] || m[3]) : null;
        insertSeriesCat.run(cat.id, cat.name, country);
      }
    });
    seriesTx();

    for (const cat of seriesCategories) {
      try {
        const itemRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_series&category_id=${encodeURIComponent(cat.id)}`);
        const itemData = await itemRes.json();
        const items = (Array.isArray(itemData) ? itemData : []).map((s, i) => ({
          id: `series_${s.series_id || i}`,
          title: s.name || 'Unknown',
          type: 'show',
          year: s.year || null,
          rating: s.rating || null,
          genre: s.genre || '',
          category_id: String(s.category_id || cat.id),
          thumb: s.cover || null,
        }));
        allSeriesItems.push(...items);

        const seriesItemTx = db.transaction(() => {
          for (const item of items) {
            insertSeriesItem.run(item.id, item.title, item.type, item.year, item.rating, item.genre, item.category_id, item.thumb);
          }
        });
        seriesItemTx();
      } catch (e) {
        console.error(`Failed to fetch Series items for category ${cat.id}:`, e.message);
      }
    }

    res.json({
      vodCategories: vodCategories.length,
      vodItems: allVodItems.length,
      seriesCategories: seriesCategories.length,
      seriesItems: allSeriesItems.length,
    });
  } catch (err) {
    dbLog('error', 'iptv/vod-series-sync', err.message, { stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── Named export for server-level scheduled sync ──────────────────────────────
export function scheduledIptvSync() {
  if (syncJob?.status === 'running') return;
  const credsMeta = db.prepare("SELECT value FROM iptv_meta WHERE key='xtream_creds'").get();
  if (!credsMeta) return;
  const creds = JSON.parse(credsMeta.value);
  syncJob = { status: 'running', started: Date.now(), trigger: 'scheduled' };
  runXtreamSync(creds.base, creds.user, creds.pass)
    .then(({ count }) => {
      syncJob = { status: 'done', count, finished: Date.now() };
      dbLog('info', 'iptv/scheduled-sync', `Daily sync completed — ${count} channels`);
    })
    .catch((err) => {
      syncJob = { status: 'error', error: err.message, finished: Date.now() };
      dbLog('error', 'iptv/scheduled-sync', err.message, { stack: err.stack });
    });
}

export default router;
