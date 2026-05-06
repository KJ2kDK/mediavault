import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import RSSParser from 'rss-parser';
import db from '../db/index.js';

const router = Router();
const parser = new RSSParser();
const execFileAsync = promisify(execFile);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// ── Parse UNIT3D-style RSS description into structured metadata ─────────────
// ── Metadata parsers ────────────────────────────────────────────────────────
// Extract structured metadata from RSS item content.  Tries UNIT3D format
// first, then falls back to a generic torrent-RSS parser that works with
// common feeds (TorrentGalaxy, RARBG-style, Jackett, etc.).

function parseUnit3dMeta(content) {
  if (!content) return null;
  if (!content.includes('<strong>') || !content.includes('Seeders')) return null;

  const meta = { _src: 'unit3d' };
  const extract = (label) => {
    const re = new RegExp(`<strong>${label}<\\/strong>\\s*:\\s*([^<]+)`, 'i');
    const m = content.match(re);
    return m ? m[1].replace(/\|/g, '').trim() : null;
  };

  meta.type       = extract('Type');
  meta.resolution = extract('Resolution');
  meta.size       = extract('Size');
  meta.seeders    = parseInt(extract('Seeders')) || 0;
  meta.leechers   = parseInt(extract('Leechers')) || 0;
  meta.completed  = parseInt(extract('Completed')) || 0;
  meta.uploader   = extract('Uploader')?.replace(/anonymous uploader/i, 'Anonymous').trim() || null;

  // IMDB — full URL or shorthand "IMDB Link:tt12345"
  const imdb = content.match(/imdb\.com\/title\/(tt\d+)/) || content.match(/IMDB\s*(?:Link)?[:\s]*(tt\d+)/i);
  if (imdb) meta.imdbId = imdb[1];

  // TMDB — full URL or shorthand "TMDB Link: 12345"
  const tmdb = content.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/) || content.match(/TMDB\s*(?:Link)?[:\s]*(\d+)/i);
  if (tmdb) meta.tmdbId = tmdb[1];

  // TVDB — full URL or shorthand "TVDB Link:12345"
  const tvdb = content.match(/thetvdb\.com\/.*?id=(\d+)/) || content.match(/TVDB\s*(?:Link)?[:\s]*(\d+)/i);
  if (tvdb) meta.tvdbId = tvdb[1];

  const detailMatch = content.match(/href="[^"]*\/torrents\/(\d+)/);
  if (detailMatch) meta.detailId = detailMatch[1];

  return meta;
}

// TorrentLeech detail page — parse HTML for seeders/leechers/snatches/IMDB.
// TL RSS is minimal; this enriches items by fetching their detail page.
// Returns null if no new data could be extracted.
function parseTorrentLeechDetail(html) {
  if (!html) return null;
  const meta = {};

  // Seeders — TL renders these in various ways across pages.
  //  <span class="seedersCount">N</span> on modern layouts
  //  <td class="seeders">N</td> on older
  //  "Seeders: N" in metadata blocks
  const seedMatch =
    html.match(/class=["'][^"']*seed(?:er|ersCount)[^"']*["'][^>]*>\s*(\d+)/i) ||
    html.match(/>\s*Seeders?\s*<[^>]*>\s*<[^>]*>\s*(\d+)/i) ||
    html.match(/Seeders?\s*:\s*(\d+)/i);
  if (seedMatch) meta.seeders = parseInt(seedMatch[1]);

  const leechMatch =
    html.match(/class=["'][^"']*leech(?:er|ersCount)[^"']*["'][^>]*>\s*(\d+)/i) ||
    html.match(/>\s*Leechers?\s*<[^>]*>\s*<[^>]*>\s*(\d+)/i) ||
    html.match(/Leechers?\s*:\s*(\d+)/i);
  if (leechMatch) meta.leechers = parseInt(leechMatch[1]);

  const snatchMatch =
    html.match(/class=["'][^"']*(?:snatched|snatchCount|completed)[^"']*["'][^>]*>\s*(\d+)/i) ||
    html.match(/>\s*(?:Snatches?|Completed|Downloaded)\s*<[^>]*>\s*<[^>]*>\s*(\d+)/i) ||
    html.match(/(?:Snatched|Completed|Downloaded)\s*:\s*(\d+)/i);
  if (snatchMatch) meta.completed = parseInt(snatchMatch[1]);

  // IMDB
  const imdbMatch = html.match(/imdb\.com\/title\/(tt\d+)/i);
  if (imdbMatch) meta.imdbId = imdbMatch[1];

  // TMDB (rare on TL but possible)
  const tmdbMatch = html.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i);
  if (tmdbMatch) meta.tmdbId = tmdbMatch[1];

  // Uploader — TL shows "Uploaded by Anonymous" or links to profile
  const uploaderMatch =
    html.match(/Uploaded by\s*<[^>]*>([^<]+)</i) ||
    html.match(/Uploaded by\s*:?\s*([^\s<,]+)/i);
  if (uploaderMatch) meta.uploader = uploaderMatch[1].trim();

  return Object.keys(meta).length ? meta : null;
}

// Enrich a batch of TorrentLeech items by fetching their detail pages.
// Limits concurrency to avoid tripping rate limits; caps total work so a
// refresh on a 350-item feed doesn't take forever (only enriches newest 50).
async function enrichTorrentLeechItems(items, cookie) {
  const targets = items
    .filter((i) => i.link && /torrentleech\.org\/(torrent|rss)/i.test(i.link))
    .slice(0, 50); // only the newest 50 per feed
  if (!targets.length) return;

  const CONCURRENCY = 5;
  let cursor = 0;

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < targets.length) {
      const item = targets[cursor++];
      try {
        const html = await fetchFeedXml(item.link, cookie);
        const extracted = parseTorrentLeechDetail(html);
        if (extracted) {
          item.meta = { ...(item.meta || {}), ...extracted };
        }
      } catch { /* silently skip one bad item */ }
    }
  });
  await Promise.all(workers);
}

function parseGenericMeta(item) {
  // Tries to pull torrent-style metadata from any RSS item's content/title
  const content = item.content || item['content:encoded'] || item.contentSnippet || '';
  const title = item.title || '';
  const combined = `${title} ${content}`;
  const meta = {};

  // Size — "1.5 GB", "700 MB", "4.2 GiB" etc.
  const sizeMatch = combined.match(/\b(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB|TB|TiB|KB|KiB))\b/i);
  if (sizeMatch) meta.size = sizeMatch[1].trim();

  // Resolution — 2160p/4K, 1080p, 720p, 480p
  const resMatch = combined.match(/\b(2160p|4K|1080p|720p|480p|UHD)\b/i);
  if (resMatch) meta.resolution = resMatch[1] === '4K' ? '2160p' : resMatch[1];

  // Quality/type — BluRay, WEB-DL, WEBRip, HDRip, BDRip, HDTV, DVDRip, CAM etc.
  const typeMatch = combined.match(/\b(BluRay|Blu-Ray|BDRip|BRRip|WEB-DL|WEBRip|WEB|HDRip|HDTV|DVDRip|DVDScr|PDTV|CAM|TS|HC|REMUX)\b/i);
  if (typeMatch) meta.type = typeMatch[1];

  // Seeders / Leechers — various formats: "S: 150 L: 20", "Seeders: 50", etc.
  const seedMatch = content.match(/(?:Seeders?|Seeds?|S)\s*[:=]\s*(\d+)/i);
  const leechMatch = content.match(/(?:Leechers?|Leech(?:es)?|L)\s*[:=]\s*(\d+)/i);
  if (seedMatch) meta.seeders = parseInt(seedMatch[1]);
  if (leechMatch) meta.leechers = parseInt(leechMatch[1]);

  // IMDB
  const imdb = combined.match(/imdb\.com\/title\/(tt\d+)/) || combined.match(/(tt\d{7,})/);
  if (imdb) meta.imdbId = imdb[1];

  // TMDB
  const tmdb = combined.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/);
  if (tmdb) meta.tmdbId = tmdb[1];

  // Enclosure size (many torrent RSS feeds put the file size in the enclosure length attribute)
  if (!meta.size && item.enclosure?.length) {
    const bytes = parseInt(item.enclosure.length);
    if (bytes > 0) {
      if (bytes >= 1073741824) meta.size = (bytes / 1073741824).toFixed(2) + ' GiB';
      else if (bytes >= 1048576) meta.size = (bytes / 1048576).toFixed(1) + ' MiB';
      else if (bytes >= 1024) meta.size = (bytes / 1024).toFixed(0) + ' KiB';
    }
  }

  // Codec — x264, x265, HEVC, H.264, H.265, AV1, VP9
  const codecMatch = combined.match(/\b(x264|x265|H\.?264|H\.?265|HEVC|AV1|VP9|AAC|DTS(?:-HD)?|Atmos|TrueHD)\b/i);
  if (codecMatch) meta.codec = codecMatch[1];

  // Only return if we found something useful
  return Object.keys(meta).length > 0 ? meta : null;
}

// Unified entry point: try UNIT3D first, then generic
function extractMeta(item) {
  const content = item.content || item['content:encoded'] || '';
  return parseUnit3dMeta(content) || parseGenericMeta(item);
}

function isCloudflareChallenge(html) {
  return html.includes('Just a moment') || html.includes('cf_chl_opt') || html.includes('challenge-platform');
}

// Get FlareSolverr URL from env or DB meta
function getFlareSolverrUrl() {
  if (process.env.FLARESOLVERR_URL) return process.env.FLARESOLVERR_URL;
  try {
    const row = db.prepare("SELECT value FROM iptv_meta WHERE key = 'flaresolverr_url'").get();
    return row?.value || null;
  } catch { return null; }
}

// Strategy 3: FlareSolverr — headless browser that solves Cloudflare JS challenges
async function fetchViaFlareSolverr(url) {
  const fsUrl = getFlareSolverrUrl();
  if (!fsUrl) return null;

  console.log(`[rss] ${url} → trying FlareSolverr at ${fsUrl}…`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65000); // FlareSolverr can be slow
    const res = await fetch(`${fsUrl}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();

    if (data.status === 'ok' && data.solution?.response) {
      let html = data.solution.response;
      if (isCloudflareChallenge(html)) {
        console.log(`[rss] ${url} → FlareSolverr still got Cloudflare challenge`);
        return null;
      }
      // FlareSolverr uses a real browser, so XML/RSS feeds get rendered as HTML
      // with the actual XML content HTML-escaped inside <pre> tags. Detect and unescape.
      if (html.includes('&lt;?xml') || html.includes('&lt;rss')) {
        html = html
          .replace(/^[\s\S]*?<pre[^>]*>/i, '')  // strip everything before <pre>
          .replace(/<\/pre>[\s\S]*$/i, '')       // strip everything after </pre>
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        console.log(`[rss] ${url} → FlareSolverr OK, unescaped XML (${html.length} bytes)`);
      } else {
        console.log(`[rss] ${url} → FlareSolverr OK (${html.length} bytes)`);
      }
      return html;
    }
    console.log(`[rss] ${url} → FlareSolverr returned status: ${data.status}, message: ${data.message || 'none'}`);
    return null;
  } catch (err) {
    console.log(`[rss] ${url} → FlareSolverr failed: ${err.message}`);
    return null;
  }
}

async function fetchFeedXml(url, cookie) {
  // Strategy 1: try Node native fetch (better TLS fingerprint than curl for Cloudflare)
  try {
    const headers = {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    };
    if (cookie) headers['Cookie'] = cookie;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    const text = await res.text();
    if (!isCloudflareChallenge(text) && text.includes('<')) {
      console.log(`[rss] ${url} → native fetch OK (${text.length} bytes)`);
      return text;
    }
    console.log(`[rss] ${url} → native fetch got Cloudflare challenge, trying curl…`);
  } catch (err) {
    console.log(`[rss] ${url} → native fetch failed: ${err.message}, trying curl…`);
  }

  // Strategy 2: curl fallback (different TLS fingerprint, sometimes works)
  try {
    const args = [
      '-s', '-L', '--max-time', '15',
      '-A', BROWSER_UA,
      '-H', 'Accept: application/rss+xml, application/xml, text/xml, */*;q=0.8',
    ];
    if (cookie) args.push('-b', cookie);
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
    if (!isCloudflareChallenge(stdout)) {
      console.log(`[rss] ${url} → curl OK (${stdout.length} bytes)`);
      return stdout;
    }
    console.log(`[rss] ${url} → curl got Cloudflare challenge, trying FlareSolverr…`);
  } catch (err) {
    console.log(`[rss] ${url} → curl failed: ${err.message}, trying FlareSolverr…`);
  }

  // Strategy 3: FlareSolverr (headless browser that solves CF challenges)
  const fsResult = await fetchViaFlareSolverr(url);
  if (fsResult) return fsResult;

  throw new Error('All fetch strategies failed — Cloudflare protected. Configure FlareSolverr (Settings → RSS) or use an RSS proxy like rss.app.');
}

router.post('/fetch', async (req, res) => {
  try {
    const { feeds } = req.body;
    if (!feeds || !Array.isArray(feeds)) {
      return res.status(400).json({ error: 'feeds array required' });
    }

    const allItems = [];
    const feedErrors = [];

    await Promise.all(feeds.map(async (feed) => {
      try {
        const xml = await fetchFeedXml(feed.url, feed.cookie);
        const parsed = await parser.parseString(xml);

        if (parsed.items[0]) {
          console.log(`[rss-debug] ${feed.name} sample item keys:`, Object.keys(parsed.items[0]));
          console.log(`[rss-debug] ${feed.name} link:`, parsed.items[0].link);
          console.log(`[rss-debug] ${feed.name} enclosure:`, parsed.items[0].enclosure);
          console.log(`[rss-debug] ${feed.name} guid:`, parsed.items[0].guid);
        }
        const feedItemsStart = allItems.length;
        parsed.items.slice(0, 150).forEach((item) => {
          const cats = extractCategories(item);
          const link = item.link || item.guid || '';
          const rawDate = item.pubDate || item.isoDate || null;
          const pubDateSec = rawDate ? Math.floor(new Date(rawDate).getTime() / 1000) : null;
          const id = createHash('md5').update(`${feed.name}::${link || item.title}`).digest('hex');
          const meta = extractMeta(item);
          // For UNIT3D feeds, build a detail page URL from the guid (torrent ID)
          const detailUrl = meta?._src === 'unit3d' && item.guid ? `${new URL(feed.url).origin}/torrents/${item.guid}` : null;
          if (meta) delete meta._src;
          allItems.push({
            id,
            title: item.title || 'Untitled',
            link,
            source: feed.name,
            date: formatDate(rawDate),
            snippet: stripHtml(item.contentSnippet || item.content || item.summary || '').slice(0, 200),
            category: cats[0] || '',
            categories: cats,
            torrentUrl: item.enclosure?.url || link || null,
            pubDateSec,
            sentAt: null,
            meta: meta ? { ...meta, detailUrl } : null,
          });
        });

        // TorrentLeech enrichment: scrape detail pages for seeders/leechers/IMDB
        if (/torrentleech\.org/i.test(feed.url)) {
          const feedItems = allItems.slice(feedItemsStart);
          await enrichTorrentLeechItems(feedItems, feed.cookie);
        }
      } catch (err) {
        console.error(`[rss] ${feed.name}: ${err.message}`);
        feedErrors.push({ name: feed.name, error: err.message });
      }
    }));

    allItems.sort((a, b) => (b.pubDateSec || 0) - (a.pubDateSec || 0));

    // Persist to DB
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO rss_items (id, feed_name, title, link, category, categories, snippet, torrent_url, pub_date, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction((items) => {
      for (const it of items) {
        upsert.run(it.id, it.source, it.title, it.link, it.category,
          JSON.stringify(it.categories), it.snippet, it.torrentUrl, it.pubDateSec,
          it.meta ? JSON.stringify(it.meta) : null);
      }
    })(allItems);

    // Re-attach sent_at from DB for any already-sent items
    const sentMap = {};
    const ids = allItems.map((i) => i.id);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`SELECT id, sent_at FROM rss_items WHERE id IN (${placeholders}) AND sent_at IS NOT NULL`)
        .all(...ids).forEach((r) => { sentMap[r.id] = r.sent_at; });
    }
    allItems.forEach((it) => { if (sentMap[it.id]) it.sentAt = sentMap[it.id]; });

    res.json({ items: allItems, count: allItems.length, errors: feedErrors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rss/ingest-xml — accept pre-fetched XML from browser ───────────
// Used when server-side fetch is blocked by Cloudflare but the browser can access the feed
router.post('/ingest-xml', async (req, res) => {
  try {
    const { feedName, xml } = req.body;
    if (!feedName || !xml) return res.status(400).json({ error: 'feedName and xml required' });

    const parsed = await parser.parseString(xml);
    const allItems = [];

    parsed.items.slice(0, 100).forEach((item) => {
      const cats = extractCategories(item);
      const link = item.link || item.guid || '';
      const rawDate = item.pubDate || item.isoDate || null;
      const pubDateSec = rawDate ? Math.floor(new Date(rawDate).getTime() / 1000) : null;
      const id = createHash('md5').update(`${feedName}::${link || item.title}`).digest('hex');
      allItems.push({
        id, title: item.title || 'Untitled', link, source: feedName,
        date: formatDate(rawDate),
        snippet: stripHtml(item.contentSnippet || item.content || item.summary || '').slice(0, 200),
        category: cats[0] || '', categories: cats,
        torrentUrl: item.enclosure?.url || link || null,
        pubDateSec, sentAt: null,
      });
    });

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO rss_items (id, feed_name, title, link, category, categories, snippet, torrent_url, pub_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction((items) => {
      for (const it of items) {
        upsert.run(it.id, it.source, it.title, it.link, it.category,
          JSON.stringify(it.categories), it.snippet, it.torrentUrl, it.pubDateSec);
      }
    })(allItems);

    res.json({ ingested: allItems.length, feedName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rss/send ───────────────────────────────────────────────────────
// Sends a torrent URL to qBittorrent and marks the item as sent in DB
router.post('/send', async (req, res) => {
  try {
    const { id, torrentUrl } = req.body;
    if (!torrentUrl) return res.status(400).json({ error: 'torrentUrl required' });

    const qbitUrl = process.env.QBIT_URL;
    if (!qbitUrl) return res.status(503).json({ error: 'qBittorrent not configured' });

    // Forward to qBittorrent via internal fetch
    const body = new URLSearchParams({ urls: torrentUrl });
    const loginRes = await fetch(`${qbitUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(process.env.QBIT_USERNAME || '')}&password=${encodeURIComponent(process.env.QBIT_PASSWORD || '')}`,
    });
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
    const addRes = await fetch(`${qbitUrl}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie || '' },
      body: body.toString(),
    });

    if (!addRes.ok) return res.status(502).json({ error: `qBittorrent returned ${addRes.status}` });

    // Mark as sent
    if (id) {
      db.prepare('UPDATE rss_items SET sent_at = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/rss/flaresolverr — get current FlareSolverr URL ─────────────────
router.get('/flaresolverr', (req, res) => {
  try {
    const url = getFlareSolverrUrl() || '';
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/rss/flaresolverr — save FlareSolverr URL to DB ─────────────────
router.put('/flaresolverr', (req, res) => {
  try {
    const { url } = req.body;
    if (url === undefined) return res.status(400).json({ error: 'url required' });
    db.prepare("INSERT OR REPLACE INTO iptv_meta (key, value) VALUES ('flaresolverr_url', ?)").run(url || '');
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rss/flaresolverr/test — test FlareSolverr connectivity ─────────
router.post('/flaresolverr/test', async (req, res) => {
  try {
    const fsUrl = req.body.url || getFlareSolverrUrl();
    if (!fsUrl) return res.status(400).json({ success: false, error: 'No FlareSolverr URL configured' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(`${fsUrl}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url: 'https://httpbin.org/get', maxTimeout: 8000 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json();
    if (data.status === 'ok') {
      res.json({ success: true, version: data.version || 'unknown' });
    } else {
      res.json({ success: false, error: data.message || 'Unknown error' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── GET /api/rss/search ───────────────────────────────────────────────────────
router.get('/search', (req, res) => {
  try {
    const { q = '', source, category, limit = 100, offset = 0 } = req.query;
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number(offset) || 0;

    let where = '1=1';
    const params = [];
    if (q.trim()) { where += ' AND title LIKE ?'; params.push(`%${q.trim()}%`); }
    if (source)   { where += ' AND feed_name = ?'; params.push(source); }
    if (category) { where += ' AND category = ?';  params.push(category); }

    const rows = db.prepare(
      `SELECT * FROM rss_items WHERE ${where} ORDER BY pub_date DESC LIMIT ? OFFSET ?`
    ).all(...params, lim, off);

    const { n: total } = db.prepare(
      `SELECT COUNT(*) AS n FROM rss_items WHERE ${where}`
    ).get(...params);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        link: r.link,
        source: r.feed_name,
        date: formatDate(r.pub_date ? new Date(r.pub_date * 1000).toISOString() : null),
        snippet: r.snippet,
        category: r.category,
        categories: JSON.parse(r.categories || '[]'),
        torrentUrl: r.torrent_url,
        pubDateSec: r.pub_date,
        sentAt: r.sent_at || null,
        meta: r.meta ? JSON.parse(r.meta) : null,
      })),
      total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractCategories(item) {
  const raw = item.categories;
  if (Array.isArray(raw) && raw.length) return raw.map(String).filter(Boolean);
  if (item.category) return [String(item.category)];
  return [];
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMins  = Math.floor((now - date) / 60000);
    const diffHours = Math.floor((now - date) / 3600000);
    const diffDays  = Math.floor((now - date) / 86400000);
    if (diffMins  < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays  <  7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// ── Server-side feed list ───────────────────────────────────────────────────
// Replaces the per-browser localStorage list so feeds sync across devices.

router.get('/feeds', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, url, cookie, enabled, sort_order FROM rss_feeds ORDER BY sort_order ASC, id ASC'
  ).all();
  // Normalise enabled to a real boolean for the frontend.
  res.json({ feeds: rows.map((r) => ({ ...r, enabled: !!r.enabled })) });
});

router.post('/feeds', (req, res) => {
  const { name, url, cookie, enabled = true } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM rss_feeds').get().n;
    const result = db.prepare(
      'INSERT INTO rss_feeds (name, url, cookie, enabled, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), url.trim(), cookie?.trim() || null, enabled ? 1 : 0, maxOrder + 1);
    const row = db.prepare(
      'SELECT id, name, url, cookie, enabled, sort_order FROM rss_feeds WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.json({ feed: { ...row, enabled: !!row.enabled } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A feed with that URL already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.patch('/feeds/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, url, cookie, enabled, sort_order } = req.body || {};
  const existing = db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'feed not found' });

  const merged = {
    name: name?.trim() ?? existing.name,
    url: url?.trim() ?? existing.url,
    cookie: cookie === undefined ? existing.cookie : (cookie?.trim() || null),
    enabled: enabled === undefined ? existing.enabled : (enabled ? 1 : 0),
    sort_order: sort_order ?? existing.sort_order,
  };

  try {
    db.prepare(
      'UPDATE rss_feeds SET name=?, url=?, cookie=?, enabled=?, sort_order=? WHERE id=?'
    ).run(merged.name, merged.url, merged.cookie, merged.enabled, merged.sort_order, id);
    const row = db.prepare(
      'SELECT id, name, url, cookie, enabled, sort_order FROM rss_feeds WHERE id = ?'
    ).get(id);
    res.json({ feed: { ...row, enabled: !!row.enabled } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Another feed already uses that URL' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/feeds/:id', (req, res) => {
  db.prepare('DELETE FROM rss_feeds WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
