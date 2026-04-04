import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import RSSParser from 'rss-parser';
import db from '../db/index.js';

const router = Router();
const parser = new RSSParser();
const execFileAsync = promisify(execFile);

async function fetchFeedXml(url, cookie) {
  // Use curl via execFile (no shell) — avoids TLS fingerprint blocking and shell escaping issues
  const args = [
    '-s', '-L', '--max-time', '15',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  ];
  if (cookie) args.push('-b', cookie);
  args.push(url);

  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
    console.log(`[rss-debug] ${url} → first 200 chars: ${stdout.slice(0, 200)}`);
    return stdout;
  } catch (err) {
    throw new Error(`curl failed: ${err.message}`);
  }
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
        parsed.items.slice(0, 50).forEach((item) => {
          const cats = extractCategories(item);
          const link = item.link || item.guid || '';
          const rawDate = item.pubDate || item.isoDate || null;
          const pubDateSec = rawDate ? Math.floor(new Date(rawDate).getTime() / 1000) : null;
          const id = createHash('md5').update(`${feed.name}::${link || item.title}`).digest('hex');
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
          });
        });
      } catch (err) {
        console.error(`[rss] ${feed.name}: ${err.message}`);
        feedErrors.push({ name: feed.name, error: err.message });
      }
    }));

    allItems.sort((a, b) => (b.pubDateSec || 0) - (a.pubDateSec || 0));

    // Persist to DB
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

export default router;
