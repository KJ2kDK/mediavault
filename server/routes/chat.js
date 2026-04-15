import { Router } from 'express';
import db from '../db/index.js';

const router = Router();

// ── Tool definitions (reusable with OpenRouter later) ────────────────────────
const tools = [
  {
    name: 'newShowsReleases',
    description: 'Show new TV / series releases from today',
    keywords: ['new show', 'new shows', 'new tv show', 'new tv shows', 'new series', 'new episode', 'tv show', 'new in tv', 'new in series'],
    fn: () => {
      const windowStart = Math.floor(Date.now() / 1000) - 86400 * 2; // last 48h
      const rows = db.prepare(`
        SELECT title, feed_name as source, category, pub_date FROM rss_items
        WHERE pub_date >= ? ORDER BY pub_date DESC LIMIT 500
      `).all(windowStart);
      const tvRows = rows.filter((r) =>
        /S\d{1,2}E\d{1,2}|\bSeason\b|\bEpisode\b/i.test(r.title) ||
        /TV|Series/i.test(r.category || '')
      ).slice(0, 25);
      if (!tvRows.length) return { answer: 'No new TV shows / series in the last 48 hours.' };
      const items = tvRows.map((r) => ({
        text: `**${r.title}** — _${r.source}_ • ${fmtAgo(r.pub_date)}`,
        nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
      }));
      return { answer: `${tvRows.length} recent TV releases:`, items };
    },
  },
  {
    name: 'newReleases',
    description: 'Show new scene releases or RSS items from today/this week',
    keywords: ['new release', 'released today', 'latest release', 'new today', 'came out', 'recent release', 'releases today', 'latest'],
    fn: () => {
      const todayStart = startOfDay(Math.floor(Date.now() / 1000));
      const rows = db.prepare(`
        SELECT title, feed_name as source, category, pub_date FROM rss_items
        WHERE pub_date >= ? ORDER BY pub_date DESC LIMIT 25
      `).all(todayStart);
      if (!rows.length) return { answer: 'No new releases found today. Try refreshing your RSS feeds.' };
      const lines = rows.map((r) => `**${r.title}**\n  _${r.source}_ • ${r.category || 'Uncategorized'} • ${fmtAgo(r.pub_date)}`);
      return { answer: `${rows.length} releases today:\n\n${lines.join('\n\n')}`, data: rows };
    },
  },
  {
    name: 'searchReleases',
    description: 'Search for specific releases by title',
    keywords: ['find', 'search', 'look for', 'looking for', 'any ', 'episode', 'released recently'],
    fn: (msg) => {
      const q = msg.replace(/\b(find|search|search for|look for|looking for|any|released recently|episodes?|new|recent|recently)\b/gi, '').replace(/\?/g, '').trim();
      if (!q || q.length < 2) return { answer: 'What should I search for? Try: "find Breaking Bad"' };
      const rows = db.prepare(`
        SELECT title, feed_name as source, category, pub_date FROM rss_items
        WHERE title LIKE ? ORDER BY pub_date DESC LIMIT 20
      `).all(fuzzyLike(q));
      if (!rows.length) return { answer: `No releases found matching "${q}".` };
      const items = rows.map((r) => ({
        text: `**${r.title}**\n  _${r.source}_ • ${fmtAgo(r.pub_date)}`,
        nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
      }));
      return { answer: `${rows.length} results for "${q}":`, items };
    },
  },
  {
    name: 'myBookmarks',
    description: 'Show saved bookmarks and favorites',
    keywords: ['bookmark', 'saved', 'favorite', 'my channels', 'my movies', 'my shows'],
    fn: () => {
      const rows = db.prepare('SELECT title, type, group_name, added_at FROM bookmarks ORDER BY added_at DESC LIMIT 20').all();
      if (!rows.length) return { answer: 'No bookmarks saved yet.' };
      const grouped = {};
      rows.forEach((r) => { (grouped[r.type] = grouped[r.type] || []).push(r); });
      let answer = 'Your bookmarks:\n\n';
      for (const [type, items] of Object.entries(grouped)) {
        answer += `**${type.charAt(0).toUpperCase() + type.slice(1)}s** (${items.length}):\n`;
        answer += items.map((i) => `  • ${i.title}`).join('\n') + '\n\n';
      }
      return { answer, data: rows };
    },
  },
  {
    name: 'watchHistory',
    description: 'Show recently watched content',
    keywords: ['watched', 'history', 'recently watched', 'last watched', 'continue', 'resume'],
    fn: () => {
      const rows = db.prepare('SELECT title, type, progress, duration, watched_at FROM watch_history ORDER BY watched_at DESC LIMIT 15').all();
      if (!rows.length) return { answer: 'No watch history yet.' };
      const lines = rows.map((r) => {
        const pct = r.duration ? Math.round((r.progress / r.duration) * 100) : 0;
        return `**${r.title}** (${r.type}) — ${pct}% watched • ${fmtAgo(r.watched_at)}`;
      });
      return { answer: `Recently watched:\n\n${lines.join('\n')}`, data: rows };
    },
  },
  {
    name: 'systemStatus',
    description: 'Show system health, errors, and sync status',
    keywords: ['error', 'status', 'health', 'problem', 'issue', 'log', 'sync'],
    fn: () => {
      const errors = db.prepare('SELECT level, source, message, created_at FROM error_logs ORDER BY created_at DESC LIMIT 10').all();
      const epgMeta = db.prepare("SELECT value FROM epg_meta WHERE key='last_fetch_at'").get();
      const channelCount = db.prepare('SELECT COUNT(*) as n FROM iptv_channels').get()?.n || 0;
      const rssCount = db.prepare('SELECT COUNT(*) as n FROM rss_items').get()?.n || 0;

      let answer = '**System Status:**\n\n';
      answer += `Channels: ${channelCount}\n`;
      answer += `RSS items: ${rssCount}\n`;
      answer += `EPG last sync: ${epgMeta ? fmtAgo(Number(epgMeta.value)) : 'Never'}\n\n`;

      if (errors.length) {
        answer += `**Recent logs (${errors.length}):**\n`;
        answer += errors.map((e) => `  [${e.level}] ${e.source}: ${e.message} • ${fmtAgo(e.created_at)}`).join('\n');
      } else {
        answer += 'No recent errors.';
      }
      return { answer };
    },
  },
  {
    name: 'channels',
    description: 'List available IPTV channels',
    keywords: ['channel list', 'channels', 'what channels', 'show channels', 'available channels'],
    fn: (msg) => {
      const groupHint = extractAfter(msg, ['in', 'from', 'group']);
      let rows;
      if (groupHint) {
        rows = db.prepare('SELECT name, group_name FROM iptv_channels WHERE group_name LIKE ? ORDER BY name LIMIT 30').all(`%${groupHint}%`);
      } else {
        // Show group summary
        rows = db.prepare('SELECT group_name, COUNT(*) as n FROM iptv_channels GROUP BY group_name ORDER BY n DESC LIMIT 20').all();
        if (!rows.length) return { answer: 'No channels loaded. Set up IPTV in Settings first.' };
        const lines = rows.map((r) => `**${r.group_name || 'Ungrouped'}** — ${r.n} channels`);
        return { answer: `Channel groups (${rows.length}):\n\n${lines.join('\n')}\n\nAsk me about a specific group: "channels in Sports"` };
      }
      if (!rows.length) return { answer: `No channels found in group "${groupHint}".` };
      const lines = rows.map((r) => `• ${r.name}`);
      return { answer: `Channels${groupHint ? ` in "${groupHint}"` : ''} (${rows.length}):\n\n${lines.join('\n')}`, data: rows };
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(epoch) {
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(epoch) {
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function startOfDay(epoch) {
  const d = new Date(epoch * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function extractChannelHint(msg) {
  const lower = msg.toLowerCase().replace(/[?!"']/g, '');
  // Try to match known channel-like patterns first (tv2, dr1, bbc, etc.)
  const chanMatch = lower.match(/\b(tv\s*\d\s*\w*(?:\s+\w+){0,2}|dr\s*\d?\s*\w*|bbc\s*\w*|cnn|hbo\s*\w*|discovery\s*\w*|eurosport\s*\w*|national\s*geo\w*|canal\s*\d*|kanal\s*\d*|viasat\s*\w*)/i);
  if (chanMatch) return chanMatch[1].trim();
  // Strip question/command words, keep potential channel names
  const stripped = lower
    .replace(/\b(what|what's|whats|is|are|show|me|the|on|playing|schedule|for|at|right|now|today|tonight|tomorrow|currently|being|played|live)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  if (stripped.length >= 2) return stripped;
  return null;
}

// Turn "goldrush" or "gold rush" into "%gold%rush%" for fuzzy LIKE matching
function fuzzyLike(q) {
  // Split camelCase/concatenated words: "goldrush" → "gold rush"
  let spaced = q.replace(/([a-z])([A-Z])/g, '$1 $2');
  // If still one word and > 6 chars, try splitting common compound patterns
  const words = spaced.split(/\s+/).filter(Boolean);
  // Join with % wildcards so "gold rush" matches "Gold.Rush", "Gold Rush", "Gold_Rush"
  return `%${words.join('%')}%`;
}

// Map country codes to full names for group matching
const COUNTRY_MAP = {
  dk: 'denmark', se: 'sweden', no: 'norway', fi: 'finland', de: 'germany',
  nl: 'netherlands', be: 'belgium', fr: 'france', es: 'spain', pt: 'portugal',
  it: 'italy', uk: 'united kingdom', us: 'usa', ca: 'canada', au: 'australia',
  pl: 'poland', ro: 'romania', hu: 'hungary', bg: 'bulgaria', lt: 'lithuania',
  ru: 'russia', in: 'india', jp: 'japan', kr: 'korea', br: 'brazil', mx: 'mexico',
  ar: 'arab', tr: 'turkey', gr: 'greece', cz: 'czech', at: 'austria', ch: 'swiss',
};

function expandCountry(hint) {
  const lower = hint.toLowerCase().trim();
  // Check if hint ends with or is a country code
  for (const [code, name] of Object.entries(COUNTRY_MAP)) {
    if (lower === code || lower.endsWith(` ${code}`)) {
      return hint.replace(new RegExp(`\\b${code}\\b`, 'i'), name);
    }
  }
  return hint;
}

function extractAfter(msg, prepositions) {
  for (const p of prepositions) {
    const match = msg.match(new RegExp(`\\b${p}\\s+(.+?)(?:\\?|$)`, 'i'));
    if (match) return match[1].trim();
  }
  return null;
}

// ── Route ────────────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.json({ answer: 'Ask me anything about your media library, live TV, releases, or system status.' });

    const lower = message.toLowerCase();

    // Match tools by keyword priority
    for (const tool of tools) {
      if (tool.keywords.some((kw) => lower.includes(kw))) {
        const result = tool.fn(message);
        return res.json(result);
      }
    }

    // No explicit match — try smart search across releases + EPG
    const cleanQ = message.replace(/\b(is|are|there|any|new|the|a|an|do|i|have|can|you|show|me|please|what|when|where|how|recently|episodes?|released|on)\b/gi, '').replace(/[?!.,]/g, '').trim();
    if (cleanQ.length >= 3) {
      const now = Math.floor(Date.now() / 1000);
      const fq = fuzzyLike(cleanQ);
      const rssRows = db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE title LIKE ? ORDER BY pub_date DESC LIMIT 10').all(fq);
      const epgRows = db.prepare(`SELECT c.name as channel, p.title, p.start, p.stop FROM epg_programmes p JOIN iptv_channels c ON p.channel_id = c.epg_id WHERE p.title LIKE ? AND p.stop > ? ORDER BY p.start LIMIT 10`).all(fq, now);

      const items = [];
      if (rssRows.length) {
        items.push({ text: `**Releases matching "${cleanQ}":**`, nav: null });
        rssRows.forEach((r) => items.push({
          text: `• **${r.title}** — _${r.source}_ • ${fmtAgo(r.pub_date)}`,
          nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
        }));
      }
      if (epgRows.length) {
        items.push({ text: `**Upcoming on TV:**`, nav: null });
        epgRows.forEach((r) => items.push({
          text: `• **${r.channel}** — ${r.title} at ${fmtTime(r.start)}`,
          nav: { page: 'livetv', search: r.channel },
        }));
      }
      if (items.length) return res.json({ answer: `Found results for "${cleanQ}":`, items });
    }

    // True fallback
    res.json({
      answer: `No results found. Try:\n\n• **"New releases today?"** — latest scene releases\n• **"New TV shows"** — new episodes from last 48h\n• **"Gold Rush episodes"** — search releases by title\n• **"Show my bookmarks"** — saved content\n• **"Watch history"** — recently played\n• **"System status"** — health & errors`,
    });
  } catch (err) {
    res.status(500).json({ answer: `Error: ${err.message}` });
  }
});

export default router;
