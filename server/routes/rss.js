import { Router } from 'express';
import { parseStringPromise } from 'xml2js';
import fetch from 'node-fetch';

const router = Router();

// Fetch and parse multiple RSS feeds
router.post('/fetch', async (req, res) => {
  try {
    const { feeds } = req.body;
    if (!feeds || !Array.isArray(feeds)) {
      return res.status(400).json({ error: 'feeds array required' });
    }

    const allItems = [];

    await Promise.all(
      feeds.map(async (feed) => {
        try {
          const response = await fetch(feed.url, {
            headers: { 'User-Agent': 'MediaVault/0.1.0' },
          });
          const xml = await response.text();
          const parsed = await parseStringPromise(xml, { explicitArray: false });

          const channel = parsed.rss?.channel || parsed.feed;
          if (!channel) return;

          const items = Array.isArray(channel.item)
            ? channel.item
            : channel.item
            ? [channel.item]
            : Array.isArray(channel.entry)
            ? channel.entry
            : channel.entry
            ? [channel.entry]
            : [];

          items.slice(0, 20).forEach((item, i) => {
            allItems.push({
              id: `${feed.id}_${i}`,
              title: item.title?._  || item.title || 'Untitled',
              link: item.link?.$ ?.href || item.link || '',
              source: feed.name,
              date: formatDate(item.pubDate || item.published || item.updated),
              snippet: stripHtml(item.description || item.summary?._ || item.summary || '').slice(0, 200),
              category: item.category?._ || item.category || extractCategory(item),
              torrentUrl: item.enclosure?.$.url || item.link?.match?.(/magnet:/)?.[0] || null,
            });
          });
        } catch (err) {
          console.error(`Failed to fetch feed ${feed.name}:`, err.message);
        }
      })
    );

    // Sort by date (newest first)
    allItems.sort((a, b) => {
      const da = new Date(a.rawDate || 0);
      const db = new Date(b.rawDate || 0);
      return db - da;
    });

    res.json({ items: allItems, count: allItems.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function extractCategory(item) {
  if (item.category) {
    if (typeof item.category === 'string') return item.category;
    if (Array.isArray(item.category)) return item.category[0]?._ || item.category[0] || '';
    return item.category._ || '';
  }
  return '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

export default router;
