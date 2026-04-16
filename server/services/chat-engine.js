import db from '../db/index.js';
import { qbitFetch } from '../routes/qbittorrent.js';
import { getMediaIndex } from '../routes/seedbox.js';
import { findRenderer, castToRenderer, stopRenderer, pauseRenderer, discoverRenderers } from './dlna-cast.js';

// ── user_preferences table (for taste tools) ───────────────────────────────
try { db.prepare('CREATE TABLE IF NOT EXISTS user_preferences (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)').run(); } catch {}

// ── Argon helper ─────────────────────────────────────────────────────────────
const EUROPE_TRIAL_TEMPLATE_ID = 1760; // DanishDynamite

async function argonCall(path, method = 'GET', body = null) {
  const baseUrl = db.prepare("SELECT value FROM iptv_meta WHERE key='argon_base_url'").get()?.value || 'https://distributors.argontv.nl';
  const apiKey = db.prepare("SELECT value FROM iptv_meta WHERE key='argon_api_key'").get()?.value;
  if (!apiKey) throw new Error('Argon API key not configured in Settings');
  const opts = {
    method,
    headers: { 'X-ApiKey': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const r = await fetch(baseUrl + path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`Argon returned non-JSON: ${text.slice(0, 200)}`); }
}

function extractId(msg) {
  const m = msg.match(/\b(?:id|line|template|#)\s*[:#]?\s*(\d{2,})\b/i) || msg.match(/\b(\d{3,})\b/);
  return m ? Number(m[1]) : null;
}

function extractQuery(msg, verbs) {
  const re = new RegExp(`\\b(?:${verbs.join('|')})\\s+(?:for\\s+)?(.+?)(?:\\?|$)`, 'i');
  const m = msg.match(re);
  return m ? m[1].trim() : null;
}

function extractPackage(msg) {
  const map = { '3 hour': 113658, '3h': 113658, '24 hour': 113657, '24h': 113657, 'test': 113657,
    '1 month': 113653, '1m': 113653, '3 month': 113654, '3m': 113654,
    '6 month': 113655, '6m': 113655, '12 month': 113656, '12m': 113656, 'year': 113656 };
  const lower = msg.toLowerCase();
  for (const [key, val] of Object.entries(map)) if (lower.includes(key)) return val;
  return 113657; // default: 24h test
}

function parseTimeRange(msg) {
  const lower = msg.toLowerCase();
  const m = lower.match(/(?:last|past|within)?\s*(\d+)\s*(hour|day|week|month|year)s?/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const multiplier = { hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 };
    return n * (multiplier[unit] || 86400);
  }
  if (/today/i.test(lower)) return 86400;
  if (/this week/i.test(lower)) return 7 * 86400;
  if (/this month/i.test(lower)) return 30 * 86400;
  if (/this year/i.test(lower)) return 365 * 86400;
  return 7 * 86400; // default: 1 week
}

function extractSearchTerms(msg) {
  return msg
    .replace(/\b(what|what's|whats|is|are|any|new|the|a|an|show|me|please|find|search|on|in|from|last|past|within|this|recent|recently|latest|seedbox|rss|iptv|vod|movies?|series|shows?|episodes?|tv|released?|downloads?|downloaded|completed?|added)\b/gi, '')
    .replace(/\b\d+\s*(hours?|days?|weeks?|months?|years?)\b/gi, '')
    .replace(/[?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtLine(l) {
  const status = l.is_suspended === false ? 'active' : (l.is_suspended ? 'suspended' : (l.status === 1 ? 'active' : 'suspended'));
  return `• **${l.line_username || l.username}** (ID ${l.id}) — ${l.product_name || 'line'} • ${status}${l.expiration_time ? ` • expires ${typeof l.expiration_time === 'number' ? new Date(l.expiration_time * 1000).toLocaleString() : l.expiration_time}` : ''}`;
}

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
  const chanMatch = lower.match(/\b(tv\s*\d\s*\w*(?:\s+\w+){0,2}|dr\s*\d?\s*\w*|bbc\s*\w*|cnn|hbo\s*\w*|discovery\s*\w*|eurosport\s*\w*|national\s*geo\w*|canal\s*\d*|kanal\s*\d*|viasat\s*\w*)/i);
  if (chanMatch) return chanMatch[1].trim();
  const stripped = lower
    .replace(/\b(what|what's|whats|is|are|show|me|the|on|playing|schedule|for|at|right|now|today|tonight|tomorrow|currently|being|played|live)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  if (stripped.length >= 2) return stripped;
  return null;
}

function fuzzyLike(q) {
  let spaced = q.replace(/([a-z])([A-Z])/g, '$1 $2');
  const words = spaced.split(/\s+/).filter(Boolean);
  return `%${words.join('%')}%`;
}

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

// ── Tool definitions ────────────────────────────────────────────────────────
const tools = [
  // ── Argon tools ───────────────────────────────────────────────────────────
  {
    name: 'argonTrialLine',
    description: 'Create a 24-hour Europe-only IPTV trial line on Argon',
    keywords: ['create trial', 'europe trial', 'new trial line', 'create line', 'trial line', 'make trial', 'argon trial'],
    fn: async () => {
      try {
        const r = await argonCall('/api/v1/create-line', 'POST', { package: 113657, template: EUROPE_TRIAL_TEMPLATE_ID });
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        const expires = r.expiration_time ? new Date(r.expiration_time * 1000).toLocaleString() : 'unknown';
        return {
          answer: `**Europe trial line created** (24h test, template: DanishDynamite)\n\n` +
            `• **Username:** \`${r.username}\`\n` +
            `• **Password:** \`${r.password}\`\n` +
            `• **Expires:** ${expires}\n` +
            `• **M3U:** ${r.m3u_download_link}\n` +
            `• **Line ID:** ${r.id}`,
        };
      } catch (e) { return { answer: `Failed to create trial: ${e.message}` }; }
    },
  },
  {
    name: 'argonBalance',
    description: 'Show Argon reseller bank balance and credits',
    keywords: ['argon balance', 'reseller balance', 'credits', 'bank balance', 'my balance'],
    fn: async () => {
      try {
        const r = await argonCall('/api/v1/balance');
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        return { answer: `**Argon reseller account**\n\n• Bank balance: **${r.bank_balance}**\n• Credits: **${r.credits}**` };
      } catch (e) { return { answer: `Failed to fetch balance: ${e.message}` }; }
    },
  },
  {
    name: 'argonLines',
    description: 'List active Argon IPTV lines',
    keywords: ['list lines', 'argon lines', 'my lines', 'active lines', 'show lines', 'iptv lines', 'all lines'],
    fn: async () => {
      try {
        const r = await argonCall('/api/v1/lines?per_page=20');
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        if (!r.lines?.length) return { answer: 'No Argon lines found.' };
        return { answer: `**${r.lines.length} Argon lines:**\n\n${r.lines.map(fmtLine).join('\n')}` };
      } catch (e) { return { answer: `Failed to fetch lines: ${e.message}` }; }
    },
  },
  {
    name: 'argonSearchLines',
    description: 'Search Argon lines by username/notes',
    keywords: ['search line', 'find line', 'search lines', 'find lines'],
    fn: async (msg) => {
      const q = extractQuery(msg, ['search line', 'search lines', 'find line', 'find lines', 'find', 'search']);
      if (!q) return { answer: 'What line should I search for? e.g. "search lines myAwesomeLine"' };
      try {
        const r = await argonCall('/api/v1/search-lines', 'POST', { query: q });
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        if (!r.entries?.length) return { answer: `No lines matching "${q}".` };
        return { answer: `**${r.entries.length} matches for "${q}":**\n\n${r.entries.map(fmtLine).join('\n')}` };
      } catch (e) { return { answer: `Search failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonLineDetails',
    description: 'Fetch credentials & details for a specific line',
    keywords: ['line details', 'line info', 'line credentials', 'show line', 'get line'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID, e.g. "line details 3559".' };
      try {
        const r = await argonCall(`/api/v1/lines/${id}`);
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        const exp = r.expiration_time ? new Date(r.expiration_time * 1000).toLocaleString() : 'unknown';
        return { answer: `**Line ${r.id}**\n\n• Username: \`${r.username}\`\n• Password: \`${r.password}\`\n• Xtream: \`${r.xtream_codes_username}\` / \`${r.xtream_codes_password}\`\n• M3U: ${r.m3u_download_link}\n• Suspended: ${r.is_suspended}\n• Auto-renew: ${r.auto_renewal}\n• Additional connections: ${r.additional_connections}\n• Expires: ${exp}` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonWatchingNow',
    description: 'Show what a line is currently playing',
    keywords: ['watching now', 'playing now', 'what is line playing', 'line watching'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID, e.g. "watching now 3559".' };
      try {
        const r = await argonCall(`/api/v1/lines/${id}/watching-now`);
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        return { answer: `**Line ${r.id}** is watching: **${r.watching_now || 'Offline'}**` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonSuspend',
    description: 'Suspend an Argon line',
    keywords: ['suspend line', 'suspend', 'pause line', 'disable line'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID, e.g. "suspend line 3559".' };
      try {
        const r = await argonCall('/api/v1/suspend', 'POST', { lines: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Line ${id} suspended (${r.successful}/${r.successful + r.failed}).` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonActivate',
    description: 'Activate a suspended Argon line',
    keywords: ['activate line', 'activate', 'resume line', 'enable line', 'unsuspend'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID, e.g. "activate line 3559".' };
      try {
        const r = await argonCall('/api/v1/activate', 'POST', { lines: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Line ${id} activated (${r.successful}/${r.successful + r.failed}).` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonRefund',
    description: 'Refund a refundable Argon line',
    keywords: ['refund line', 'refund'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID, e.g. "refund line 3559".' };
      try {
        const r = await argonCall('/api/v1/refund', 'POST', { lines: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Line ${id} refund: ${r.successful}/${r.successful + r.failed}.` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonEnableAutoRenew',
    description: 'Enable auto-renewal for a line',
    keywords: ['enable auto', 'enable renew', 'auto renew on', 'turn on auto'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID.' };
      try {
        const r = await argonCall('/api/v1/enable-auto-renew', 'POST', { lines: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Auto-renew enabled for line ${id}.` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonDisableAutoRenew',
    description: 'Disable auto-renewal for a line',
    keywords: ['disable auto', 'disable renew', 'auto renew off', 'turn off auto'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID.' };
      try {
        const r = await argonCall('/api/v1/disable-auto-renew', 'POST', { lines: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Auto-renew disabled for line ${id}.` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonExtend',
    description: 'Extend a line by a package duration',
    keywords: ['extend line', 'extend', 'renew line'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a line ID and package, e.g. "extend line 3559 1 month".' };
      const pkg = extractPackage(msg);
      try {
        const r = await argonCall('/api/v1/extend', 'POST', { lines: [id], package: pkg });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Line ${id} extended (pkg ${pkg}): ${r.successful}/${r.successful + r.failed}.` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonCreateLine',
    description: 'Create a new Argon IPTV line with any package',
    keywords: ['create new line', 'new line', 'create iptv line', 'create paid line', 'create month', 'create subscription'],
    fn: async (msg) => {
      const pkg = extractPackage(msg);
      try {
        const r = await argonCall('/api/v1/create-line', 'POST', { package: pkg });
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        const exp = r.expiration_time ? new Date(r.expiration_time * 1000).toLocaleString() : 'unknown';
        return { answer: `**Line created** (package ${pkg})\n\n• Username: \`${r.username}\`\n• Password: \`${r.password}\`\n• M3U: ${r.m3u_download_link}\n• Expires: ${exp}\n• ID: ${r.id}` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonTemplates',
    description: 'List Argon templates',
    keywords: ['list templates', 'argon templates', 'show templates', 'all templates'],
    fn: async () => {
      try {
        const r = await argonCall('/api/v1/templates?per_page=50');
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        if (!r.templates?.length) return { answer: 'No templates found.' };
        const lines = r.templates.map((t) => `• **${t.name}** (ID ${t.id}) — created ${t.created_at}`);
        return { answer: `**${r.templates.length} templates:**\n\n${lines.join('\n')}` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonSearchTemplates',
    description: 'Search Argon templates by name',
    keywords: ['search template', 'find template'],
    fn: async (msg) => {
      const q = extractQuery(msg, ['search template', 'search templates', 'find template', 'find templates']);
      if (!q) return { answer: 'What template should I search for?' };
      try {
        const r = await argonCall('/api/v1/search-templates', 'POST', { query: q });
        if (r.error) return { answer: `Argon error: ${JSON.stringify(r)}` };
        if (!r.entries?.length) return { answer: `No templates matching "${q}".` };
        const lines = r.entries.map((t) => `• **${t.name}** (ID ${t.id})`);
        return { answer: `**${r.entries.length} matches:**\n\n${lines.join('\n')}` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonDeleteTemplate',
    description: 'Delete a template by ID',
    keywords: ['delete template', 'remove template'],
    fn: async (msg) => {
      const id = extractId(msg);
      if (!id) return { answer: 'Provide a template ID, e.g. "delete template 1760".' };
      try {
        const r = await argonCall('/api/v1/delete-templates', 'POST', { templates: [id] });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Template ${id} deleted (${r.successful}/${r.successful + r.failed}).` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'argonEditLine',
    description: 'Apply a template to an existing line',
    keywords: ['edit line', 'apply template', 'change template', 'set template'],
    fn: async (msg) => {
      const ids = [...msg.matchAll(/\b(\d{3,})\b/g)].map((m) => Number(m[1]));
      if (ids.length < 2) return { answer: 'Provide both line ID and template ID, e.g. "apply template 1760 to line 3559".' };
      const [first, second] = ids;
      const templateMatch = msg.match(/template\s+#?(\d+)/i);
      const lineMatch = msg.match(/line\s+#?(\d+)/i);
      const templateId = templateMatch ? Number(templateMatch[1]) : first;
      const lineId = lineMatch ? Number(lineMatch[1]) : second;
      try {
        const r = await argonCall(`/api/v1/lines/${lineId}/edit`, 'POST', { template: templateId });
        return { answer: r.error ? `Argon error: ${JSON.stringify(r)}` : `Line ${lineId} updated with template ${templateId}.` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },

  // ── Play / taste tools (high priority) ────────────────────────────────────
  {
    name: 'playMedia',
    description: 'Play a movie, series episode, or live TV channel. Supports resume from watch history.',
    keywords: ['play ', 'start ', 'watch ', 'put on ', 'turn on '],
    fn: async (msg) => {
      const query = msg.replace(/\b(play|start|watch|put on|turn on|please|can you|for me|from where i left|resume|continue|from bookmark|the channel|channel)\b/gi, '').replace(/[?!.,]/g, '').trim();
      if (!query || query.length < 2) return { answer: 'What should I play? e.g. "play Peaky Blinders" or "play TV2 News"' };

      // Try live TV channel — build fuzzy search patterns
      // "tv2 news denmark" → search for channel name containing "tv" + "2" + "news" AND group containing "DNK" or "denmark"
      const countryHints = Object.entries(COUNTRY_MAP);
      let channelSearch = query;
      let groupFilter = null;

      // Extract country hint from query
      for (const [code, name] of countryHints) {
        const re = new RegExp(`\\b(${name}|${code})\\b`, 'i');
        if (re.test(query)) {
          groupFilter = code.toUpperCase();
          channelSearch = query.replace(re, '').trim();
          break;
        }
      }

      // Build fuzzy LIKE: "tv2 news" → "%tv%2%news%"
      // Also split concatenated patterns like "tv2" → "tv 2", "bbc1" → "bbc 1"
      const expanded = channelSearch.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');
      const words = expanded.split(/\s+/).filter(Boolean);
      const fuzzyChannel = `%${words.join('%')}%`;

      let channels;
      if (groupFilter) {
        channels = db.prepare('SELECT id, name, group_name, url, epg_id FROM iptv_channels WHERE name LIKE ? AND (group_name LIKE ? OR name LIKE ?) ORDER BY name LIMIT 10')
          .all(fuzzyChannel, `%${groupFilter}%`, `%${groupFilter}%`);
      } else {
        channels = db.prepare('SELECT id, name, group_name, url, epg_id FROM iptv_channels WHERE name LIKE ? ORDER BY name LIMIT 10')
          .all(fuzzyChannel);
      }

      if (channels.length) {
        // Deduplicate by base name (e.g. "TV 2 NEWS" appears as [720p], [H265], plain)
        const seen = new Map();
        for (const ch of channels) {
          const base = ch.name.replace(/\s*\[(720p|1080p|H265|4K[^\]]*)\]\s*/gi, '').trim();
          if (!seen.has(base)) seen.set(base, ch);
        }
        const unique = [...seen.values()];

        // If multiple distinct channels, ask user to pick
        if (unique.length > 1 && unique.length <= 6) {
          const options = unique.map((ch, i) => `${i + 1}. **${ch.name}** (${ch.group_name || 'unknown group'})`);
          return { answer: `Multiple matches found. Which one?\n\n${options.join('\n')}\n\nTry: "play ${unique[0].name.replace(/\|/g, '').trim()}"` };
        }

        // Single match (or pick best from duplicates)
        const best = channels.find(c => /720p/i.test(c.name)) || channels[0];
        const now = Math.floor(Date.now() / 1000);
        let epgInfo = '';
        if (best.epg_id) {
          const prog = db.prepare('SELECT title, start, stop FROM epg_programmes WHERE channel_id = ? AND start <= ? AND stop > ? LIMIT 1').get(best.epg_id, now, now);
          if (prog) epgInfo = ` — now showing: ${prog.title} (${fmtTime(prog.start)}–${fmtTime(prog.stop)})`;
        }
        return {
          answer: `Playing **${best.name}**${epgInfo}`,
          action: { type: 'play-channel', channelId: best.id, name: best.name, streamUrl: best.url },
        };
      }

      // Try bookmarks (channels, VOD, series the user saved)
      const bookmarkFuzzy = `%${words.join('%')}%`;
      const bookmark = db.prepare('SELECT id, type, title, url, group_name FROM bookmarks WHERE title LIKE ? ORDER BY added_at DESC LIMIT 1').get(bookmarkFuzzy);
      if (bookmark && bookmark.url) {
        if (bookmark.type === 'channel') {
          return {
            answer: `Playing bookmark **${bookmark.title}**`,
            action: { type: 'play-channel', channelId: bookmark.id, name: bookmark.title, streamUrl: bookmark.url },
          };
        }
        return {
          answer: `Playing bookmark **${bookmark.title}**`,
          action: { type: 'play', itemId: bookmark.id, title: bookmark.title, resumeAt: 0, streamUrl: bookmark.url },
        };
      }

      // Try seedbox media via watch_history for resume
      const historyMatch = db.prepare('SELECT item_id, title, type, progress, duration FROM watch_history WHERE title LIKE ? ORDER BY watched_at DESC LIMIT 1').get(`%${query}%`);
      if (historyMatch) {
        // item_id may have "seedbox:" prefix — strip it for the numeric ID
        const rawId = String(historyMatch.item_id).replace(/^seedbox:/, '');
        const numId = Number(rawId);
        const resumeAt = historyMatch.duration && historyMatch.progress < historyMatch.duration * 0.9 ? Math.floor(historyMatch.progress) : 0;
        const resumeLabel = resumeAt > 0 ? ` (resuming at ${Math.floor(resumeAt/60)}:${String(Math.floor(resumeAt%60)).padStart(2,'0')})` : '';
        return {
          answer: `Playing **${historyMatch.title}**${resumeLabel}`,
          action: { type: 'play', itemId: numId, title: historyMatch.title, resumeAt, streamUrl: `/api/seedbox/stream/${numId}` },
        };
      }

      // Try seedbox library (in-memory index from last scan)
      const index = getMediaIndex();
      if (index.size > 0) {
        const searchLower = query.toLowerCase();
        for (const [id, item] of index) {
          const title = (item.showTitle || item.title || item.name || '').toLowerCase();
          if (title.includes(searchLower) || searchLower.split(/\s+/).every(w => title.includes(w))) {
            return {
              answer: `Playing **${item.showTitle ? `${item.showTitle} — ${item.title}` : item.title}** from seedbox`,
              action: { type: 'play', itemId: id, title: item.title, resumeAt: 0, streamUrl: `/api/seedbox/stream/${id}` },
            };
          }
        }
      }

      return { answer: `Couldn't find "${query}" in live TV channels, bookmarks, seedbox library, or watch history. Try the exact name.` };
    },
  },
  {
    name: 'castMedia',
    description: 'Cast a movie, series, or live TV to Shield/TV via DLNA with full Atmos/DTS passthrough',
    keywords: ['cast ', 'cast to', 'send to shield', 'play on shield', 'play on tv', 'chromecast', 'dlna', 'cast to shield', 'on the tv', 'on my tv', 'on shield'],
    fn: async (msg) => {
      const query = msg
        .replace(/\b(cast|send|play|start|watch|to|on|the|my|shield|tv|please|can you|for me|chromecast|dlna)\b/gi, '')
        .replace(/[?!.,]/g, '').trim();

      if (!query || query.length < 2) {
        // No media specified — list available renderers
        const names = await discoverRenderers();
        if (!names.length) return { answer: 'No DLNA devices found on the network. Make sure your Shield/TV is on and connected.' };
        const list = names.map(r => `• **${r.friendlyName}** (${r.host})`).join('\n');
        return { answer: `**DLNA devices found:**\n\n${list}\n\nTry: "cast Hunting Season to Shield"` };
      }

      // Find the renderer (Shield)
      const renderer = await findRenderer('shield');
      if (!renderer) {
        const all = await discoverRenderers();
        if (!all.length) return { answer: 'No DLNA devices found on the network. Make sure your Shield is on.' };
        const r = all[0];
        return { answer: `Shield not found, but found: **${r.friendlyName}**. Try: "cast ${query} to ${r.friendlyName}"` };
      }

      // Determine the server's LAN address for the stream URL
      const host = process.env.MEDIAVAULT_LAN_URL || `http://localhost:${process.env.PORT || 3001}`;

      // Search for media (same logic as playMedia)
      const expanded = query.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');
      const words = expanded.split(/\s+/).filter(Boolean);
      const fuzzyChannel = `%${words.join('%')}%`;

      // Try live TV channel
      const channel = db.prepare('SELECT id, name, url FROM iptv_channels WHERE name LIKE ? LIMIT 1').get(fuzzyChannel);
      if (channel && channel.url) {
        try {
          await castToRenderer(renderer, channel.url, channel.name);
          return { answer: `Casting **${channel.name}** to **${renderer.friendlyName}** — full audio passthrough` };
        } catch (e) { return { answer: `Cast failed: ${e.message}` }; }
      }

      // Try bookmarks
      const bookmark = db.prepare('SELECT id, title, url FROM bookmarks WHERE title LIKE ? LIMIT 1').get(fuzzyChannel);
      if (bookmark && bookmark.url) {
        try {
          await castToRenderer(renderer, bookmark.url, bookmark.title);
          return { answer: `Casting **${bookmark.title}** to **${renderer.friendlyName}** — full audio passthrough` };
        } catch (e) { return { answer: `Cast failed: ${e.message}` }; }
      }

      // Try seedbox media — serve raw file URL (no remux = full Atmos/DTS)
      const index = getMediaIndex();
      const searchLower = query.toLowerCase();
      for (const [id, item] of index) {
        const title = (item.showTitle || item.title || item.name || '').toLowerCase();
        if (title.includes(searchLower) || searchLower.split(/\s+/).every(w => title.includes(w))) {
          const streamUrl = `${host}/api/seedbox/stream?id=${id}&mode=direct`;
          const displayTitle = item.showTitle ? `${item.showTitle} — ${item.title}` : item.title;
          try {
            await castToRenderer(renderer, streamUrl, displayTitle);
            return { answer: `Casting **${displayTitle}** to **${renderer.friendlyName}** — raw file, full Atmos/DTS passthrough` };
          } catch (e) { return { answer: `Cast failed: ${e.message}` }; }
        }
      }

      return { answer: `Couldn't find "${query}" to cast. Try the exact title.` };
    },
  },
  {
    name: 'castStop',
    description: 'Stop playback on Shield/TV',
    keywords: ['stop cast', 'stop shield', 'stop tv', 'stop playing on'],
    fn: async () => {
      const renderer = await findRenderer('shield');
      if (!renderer) return { answer: 'No Shield/DLNA device found.' };
      try {
        await stopRenderer(renderer);
        return { answer: `Stopped playback on **${renderer.friendlyName}**` };
      } catch (e) { return { answer: `Stop failed: ${e.message}` }; }
    },
  },
  {
    name: 'castPause',
    description: 'Pause playback on Shield/TV',
    keywords: ['pause cast', 'pause shield', 'pause tv'],
    fn: async () => {
      const renderer = await findRenderer('shield');
      if (!renderer) return { answer: 'No Shield/DLNA device found.' };
      try {
        await pauseRenderer(renderer);
        return { answer: `Paused playback on **${renderer.friendlyName}**` };
      } catch (e) { return { answer: `Pause failed: ${e.message}` }; }
    },
  },
  {
    name: 'setPreference',
    description: 'Save a viewing preference (genres, styles, things to avoid)',
    keywords: ['i like', 'i love', 'i hate', 'i prefer', 'i enjoy', 'my taste', 'set preference'],
    fn: (msg) => {
      const pref = msg.replace(/\b(i like|i love|i hate|i prefer|i enjoy|set preference|please|can you|remember)\b/gi, '').replace(/[?!.,]/g, '').trim();
      if (!pref) return { answer: 'Tell me what you like or dislike, e.g. "I like Nordic noir" or "I hate horror".' };
      const isNegative = /\b(hate|dislike|dont like|don't like|avoid|no more)\b/i.test(msg);
      const key = isNegative ? 'avoid' : 'likes';
      const existing = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(key)?.value || '';
      const updated = existing ? `${existing}, ${pref}` : pref;
      db.prepare('INSERT OR REPLACE INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)').run(key, updated, Math.floor(Date.now()/1000));
      return { answer: `Got it! ${isNegative ? 'Avoiding' : 'Noted preference for'}: **${pref}**\n\nCurrent ${key}: ${updated}` };
    },
  },
  {
    name: 'recommendMedia',
    description: 'Get a media recommendation based on taste profile',
    keywords: ['recommend', 'suggestion', 'what should i watch', 'something to watch', 'pick something'],
    fn: () => {
      const likes = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get('likes')?.value || 'not set';
      const avoids = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get('avoid')?.value || 'not set';
      const watchCount = db.prepare('SELECT COUNT(*) as n FROM watch_history').get()?.n || 0;
      return { answer: `**Your taste profile:**\n\n• Likes: ${likes}\n• Avoids: ${avoids}\n• Watch history: ${watchCount} items\n\n${watchCount < 20 ? 'Need more watch data for smart recommendations (at least 20 items). Keep watching!' : 'Recommendation engine coming soon!'}` };
    },
  },

  // ── Seedbox tools ─────────────────────────────────────────────────────────
  {
    name: 'seedboxStatus',
    description: 'Show active qBittorrent downloads with progress and speed',
    keywords: ['seedbox status', 'downloading', 'torrent status', 'active torrents', 'qbit status', 'qbittorrent', 'active downloads'],
    fn: async () => {
      try {
        const res = await qbitFetch('/api/v2/torrents/info');
        if (!res.ok) return { answer: 'qBittorrent unreachable — check QBIT_URL.' };
        const all = await res.json();
        const active = all.filter((t) => t.progress < 1);
        const completed = all.filter((t) => t.progress === 1);
        let answer = `**Seedbox:** ${all.length} torrents (${active.length} active, ${completed.length} completed)\n\n`;
        if (active.length) {
          answer += '**Active downloads:**\n';
          active.forEach((t) => {
            const pct = (t.progress * 100).toFixed(1);
            const dl = (t.dlspeed / 1024 / 1024).toFixed(1);
            const eta = t.eta > 0 && t.eta < 8640000 ? `${Math.round(t.eta / 60)}min` : '∞';
            answer += `• **${t.name}** — ${pct}% ↓${dl} MB/s • ETA ${eta}\n`;
          });
        } else {
          answer += 'No active downloads.\n';
        }
        return { answer };
      } catch (e) { return { answer: `Seedbox check failed: ${e.message}` }; }
    },
  },
  {
    name: 'seedboxNew',
    description: 'Show recently completed downloads on the seedbox',
    keywords: ['new on seedbox', 'new in seedbox', 'seedbox new', 'recently downloaded', 'completed downloads', 'finished downloads', 'new downloads', 'what downloaded', "what's new on seedbox", 'new seedbox', 'whats new seedbox'],
    fn: async () => {
      try {
        const res = await qbitFetch('/api/v2/torrents/info');
        if (!res.ok) return { answer: 'qBittorrent unreachable.' };
        const all = await res.json();
        const completed = all.filter((t) => t.progress === 1);
        completed.sort((a, b) => (b.completion_on || 0) - (a.completion_on || 0));
        const recent = completed.slice(0, 15);
        if (!recent.length) return { answer: 'No completed torrents on the seedbox.' };
        const lines = recent.map((t) => {
          const size = (t.size / 1024 / 1024 / 1024).toFixed(2);
          const when = t.completion_on ? fmtAgo(t.completion_on) : 'unknown';
          return `• **${t.name}** — ${size} GB • completed ${when}`;
        });
        return { answer: `**${recent.length} recently completed:**\n\n${lines.join('\n')}` };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },
  {
    name: 'seedboxStorage',
    description: 'Show seedbox disk usage and free space',
    keywords: ['seedbox storage', 'disk space', 'free space', 'disk usage', 'seedbox space', 'how much space'],
    fn: async () => {
      try {
        const res = await qbitFetch('/api/v2/sync/maindata');
        if (!res.ok) return { answer: 'qBittorrent unreachable.' };
        const data = await res.json();
        const info = data.server_state || {};
        const freeGb = info.free_space_on_disk ? (info.free_space_on_disk / 1024 / 1024 / 1024).toFixed(1) : 'unknown';
        const dlSpeed = info.dl_info_speed ? (info.dl_info_speed / 1024 / 1024).toFixed(1) : '0';
        const ulSpeed = info.up_info_speed ? (info.up_info_speed / 1024 / 1024).toFixed(1) : '0';
        const dlTotal = info.dl_info_data ? (info.dl_info_data / 1024 / 1024 / 1024).toFixed(1) : '?';
        const ulTotal = info.up_info_data ? (info.up_info_data / 1024 / 1024 / 1024).toFixed(1) : '?';
        return {
          answer: `**Seedbox storage & activity:**\n\n` +
            `• Free disk: **${freeGb} GB**\n` +
            `• Download speed: ↓${dlSpeed} MB/s (total: ${dlTotal} GB)\n` +
            `• Upload speed: ↑${ulSpeed} MB/s (total: ${ulTotal} GB)\n` +
            `• Active torrents: ${info.dl_info_speed > 0 ? 'downloading' : 'idle'}`,
        };
      } catch (e) { return { answer: `Failed: ${e.message}` }; }
    },
  },

  // ── Media discovery tools ─────────────────────────────────────────────────
  {
    name: 'newMovies',
    description: 'Search for new movies across RSS, seedbox, and IPTV VOD with flexible time range',
    keywords: ['new movie', 'new movies', 'recent movie', 'recent movies', 'movies this week', 'latest movie', 'latest movies', 'movie release', 'movies last', 'movies from'],
    fn: async (msg) => {
      const windowSec = parseTimeRange(msg);
      const cutoff = Math.floor(Date.now() / 1000) - windowSec;
      const search = extractSearchTerms(msg);
      const fq = search ? fuzzyLike(search) : null;
      const windowLabel = windowSec < 86400 ? 'today' : `last ${Math.round(windowSec / 86400)} days`;
      const results = [];

      const rssQ = fq
        ? db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE pub_date >= ? AND title LIKE ? ORDER BY pub_date DESC LIMIT 200').all(cutoff, fq)
        : db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE pub_date >= ? ORDER BY pub_date DESC LIMIT 500').all(cutoff);
      const movieCats = /^(Movies|BlurayRip|DVDrip|WEBRip|4K|Bluray|Foreign|Documentaries)$/i;
      const movieRows = rssQ.filter((r) =>
        (movieCats.test(r.category || '') || fq) &&
        !/S\d{1,2}E\d{1,2}|\bS\d{1,2}\b|\bSeason\b|\bComplete\s+Series/i.test(r.title)
      );
      movieRows.slice(0, 25).forEach((r) => results.push({
        text: `**${r.title}** — _${r.source}_ • ${r.category} • ${fmtAgo(r.pub_date)}`,
        nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
        source: 'RSS',
      }));

      try {
        const res = await qbitFetch('/api/v2/torrents/info');
        if (res.ok) {
          const torrents = await res.json();
          const completed = torrents.filter((t) => t.progress === 1 && t.completion_on >= cutoff);
          const filtered = search ? completed.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : completed;
          filtered.filter((t) => !/S\d{1,2}E\d{1,2}/i.test(t.name)).slice(0, 10).forEach((t) => results.push({
            text: `**${t.name}** — _seedbox_ • ${(t.size/1024/1024/1024).toFixed(1)} GB • ${fmtAgo(t.completion_on)}`,
            nav: null,
            source: 'Seedbox',
          }));
        }
      } catch {}

      if (!results.length) return { answer: `No movies found${search ? ` matching "${search}"` : ''} in the ${windowLabel}.` };
      const items = results.map((r) => ({ text: r.text, nav: r.nav }));
      return { answer: `${results.length} movie results (${windowLabel}):`, items };
    },
  },
  {
    name: 'newShowsReleases',
    description: 'Search for new TV shows/series across RSS and seedbox with flexible time range',
    keywords: ['new show', 'new shows', 'new tv show', 'new tv shows', 'new series', 'new episode', 'tv show', 'new in tv', 'new in series', 'series this week', 'latest series', 'latest show', 'recent series', 'recent show', 'series last', 'shows last', 'episode last'],
    fn: async (msg) => {
      const windowSec = parseTimeRange(msg);
      const cutoff = Math.floor(Date.now() / 1000) - windowSec;
      const search = extractSearchTerms(msg);
      const fq = search ? fuzzyLike(search) : null;
      const windowLabel = windowSec < 86400 ? 'today' : `last ${Math.round(windowSec / 86400)} days`;
      const results = [];

      const rssQ = fq
        ? db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE pub_date >= ? AND title LIKE ? ORDER BY pub_date DESC LIMIT 200').all(cutoff, fq)
        : db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE pub_date >= ? ORDER BY pub_date DESC LIMIT 500').all(cutoff);
      const tvRows = rssQ.filter((r) =>
        /S\d{1,2}E\d{1,2}|\bSeason\b|\bEpisode\b/i.test(r.title) ||
        /TV|Series|Episodes|BoxSets/i.test(r.category || '') ||
        (fq && /S\d{1,2}/i.test(r.title))
      );
      tvRows.slice(0, 25).forEach((r) => results.push({
        text: `**${r.title}** — _${r.source}_ • ${fmtAgo(r.pub_date)}`,
        nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
      }));

      try {
        const res = await qbitFetch('/api/v2/torrents/info');
        if (res.ok) {
          const torrents = await res.json();
          const completed = torrents.filter((t) => t.progress === 1 && t.completion_on >= cutoff);
          const filtered = search ? completed.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : completed;
          filtered.filter((t) => /S\d{1,2}E\d{1,2}/i.test(t.name)).slice(0, 10).forEach((t) => results.push({
            text: `**${t.name}** — _seedbox_ • ${(t.size/1024/1024/1024).toFixed(1)} GB • ${fmtAgo(t.completion_on)}`,
            nav: null,
          }));
        }
      } catch {}

      if (!results.length) return { answer: `No TV shows/series found${search ? ` matching "${search}"` : ''} in the ${windowLabel}.` };
      const items = results.map((r) => ({ text: r.text, nav: r.nav }));
      return { answer: `${results.length} TV/series results (${windowLabel}):`, items };
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

  // ── User data tools ───────────────────────────────────────────────────────
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

  // ── System & EPG tools ────────────────────────────────────────────────────
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
    name: 'whatsOnNow',
    description: 'Show what is currently playing on a specific channel or across all channels (EPG)',
    keywords: ['what is on', "what's on", 'whats on', 'showing on', 'playing on', 'on now', 'now on', 'currently on', 'live on'],
    fn: (msg) => {
      const now = Math.floor(Date.now() / 1000);
      const search = extractSearchTerms(msg);
      if (search && search.length >= 2) {
        const channels = db.prepare('SELECT name, epg_id FROM iptv_channels WHERE name LIKE ? OR epg_id LIKE ? LIMIT 5').all(`%${search}%`, `%${search}%`);
        if (!channels.length) return { answer: `No channels matching "${search}". Try "what's on TV 2" or "what's on BBC".` };
        const results = [];
        for (const ch of channels) {
          if (!ch.epg_id) continue;
          const prog = db.prepare('SELECT title, start, stop, description FROM epg_programmes WHERE channel_id = ? AND start <= ? AND stop > ? ORDER BY start LIMIT 1').get(ch.epg_id, now, now);
          const next = db.prepare('SELECT title, start FROM epg_programmes WHERE channel_id = ? AND start > ? ORDER BY start LIMIT 1').get(ch.epg_id, now);
          if (prog) {
            results.push(`**${ch.name}** — NOW: **${prog.title}** (${fmtTime(prog.start)}–${fmtTime(prog.stop)})${prog.description ? `\n  _${prog.description.slice(0, 120)}_` : ''}${next ? `\n  Next: ${next.title} at ${fmtTime(next.start)}` : ''}`);
          } else if (next) {
            results.push(`**${ch.name}** — No current EPG data. Next: **${next.title}** at ${fmtTime(next.start)}`);
          } else {
            results.push(`**${ch.name}** — No EPG data available (may need an EPG refresh)`);
          }
        }
        return { answer: results.join('\n\n') };
      }
      const rows = db.prepare(`
        SELECT c.name, p.title, p.start, p.stop FROM epg_programmes p
        JOIN iptv_channels c ON c.epg_id = p.channel_id
        WHERE p.start <= ? AND p.stop > ?
        ORDER BY c.name LIMIT 30
      `).all(now, now);
      if (!rows.length) return { answer: 'No current EPG data. The EPG may need a refresh — try Settings > IPTV > Refresh EPG.' };
      const lines = rows.map((r) => `• **${r.name}** — ${r.title} (${fmtTime(r.start)}–${fmtTime(r.stop)})`);
      return { answer: `**Now on TV (${rows.length} channels):**\n\n${lines.join('\n')}` };
    },
  },
  {
    name: 'channelSchedule',
    description: 'Show the EPG schedule/programme guide for a channel today or upcoming',
    keywords: ['schedule for', 'schedule on', 'programme guide', 'tv guide', 'epg for', 'tonight on', 'today on'],
    fn: (msg) => {
      const now = Math.floor(Date.now() / 1000);
      const search = extractSearchTerms(msg);
      if (!search || search.length < 2) return { answer: 'Which channel? e.g. "schedule for TV 2" or "tonight on BBC One".' };
      const channels = db.prepare('SELECT name, epg_id FROM iptv_channels WHERE name LIKE ? OR epg_id LIKE ? LIMIT 3').all(`%${search}%`, `%${search}%`);
      if (!channels.length) return { answer: `No channels matching "${search}".` };
      const results = [];
      for (const ch of channels) {
        if (!ch.epg_id) continue;
        const progs = db.prepare('SELECT title, start, stop FROM epg_programmes WHERE channel_id = ? AND stop > ? ORDER BY start LIMIT 15').all(ch.epg_id, now);
        if (!progs.length) { results.push(`**${ch.name}** — No EPG data available.`); continue; }
        const lines = progs.map((p) => {
          const isNow = p.start <= now && p.stop > now;
          return `${isNow ? '▶ ' : '  '}${fmtTime(p.start)}–${fmtTime(p.stop)} **${p.title}**`;
        });
        results.push(`**${ch.name}** schedule:\n${lines.join('\n')}`);
      }
      return { answer: results.join('\n\n') };
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

// ── OpenRouter LLM integration ──────────────────────────────────────────────
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-3-4b-it:free';

function buildSystemPrompt() {
  return `You are a media assistant router. Pick the best tool for the user's request. Respond with ONLY a JSON object (no markdown, no explanation):
{"tool":"toolName","message":"the original user message"}

If no tool fits: {"tool":null,"search":"keywords or null","answer":"short helpful response"}

Tools:
- argonTrialLine: Create 24h Europe IPTV trial
- argonBalance: Show Argon reseller balance/credits
- argonLines: List Argon IPTV lines
- argonSearchLines: Search lines by username
- argonLineDetails: Get line credentials (needs ID)
- argonWatchingNow: What a line is playing (needs ID)
- argonSuspend: Suspend a line (needs ID)
- argonActivate: Activate a line (needs ID)
- argonRefund: Refund a line (needs ID)
- argonEnableAutoRenew: Enable auto-renew (needs ID)
- argonDisableAutoRenew: Disable auto-renew (needs ID)
- argonExtend: Extend a line (needs ID + duration)
- argonCreateLine: Create new line (any package)
- argonTemplates: List templates
- argonSearchTemplates: Search templates
- argonDeleteTemplate: Delete template (needs ID)
- argonEditLine: Apply template to line (needs both IDs)
- playMedia: Play a movie, series, or live TV channel in browser
- castMedia: Cast media to Shield/TV via DLNA (full Atmos/DTS passthrough)
- castStop: Stop playback on Shield/TV
- castPause: Pause playback on Shield/TV
- setPreference: Save taste preferences (likes/dislikes)
- recommendMedia: Get recommendation based on taste
- seedboxStatus: Active downloads with progress
- seedboxNew: Recently completed downloads
- seedboxStorage: Disk space and transfer stats
- newMovies: Search new movies (RSS + seedbox)
- newShowsReleases: Search new TV shows/series
- newReleases: Latest scene releases
- searchReleases: Search releases by title
- myBookmarks: Show saved bookmarks
- watchHistory: Show recently watched
- systemStatus: System health and errors
- whatsOnNow: What is on a TV channel now (EPG)
- channelSchedule: TV programme guide for a channel
- channels: List IPTV channel groups`;
}

async function llmClassify(userMessage) {
  if (!OPENROUTER_KEY) return null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://mediavault.local',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: OPENROUTER_MODEL.includes('gemma')
          ? [{ role: 'user', content: `${buildSystemPrompt()}\n\n---\nUser message: ${userMessage}` }]
          : [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content: userMessage }],
        max_tokens: 200,
        temperature: 0,
      }),
    });
    const data = await r.json();
    if (data.error) { console.warn('[chat] LLM API error:', data.error.message); return null; }
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) { console.warn('[chat] LLM returned empty content'); return null; }
    const clean = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.warn('[chat] LLM classify failed:', e.message);
    return null;
  }
}

// ── Main entry point ────────────────────────────────────────────────────────
export async function processMessage(message) {
  if (!message?.trim()) return { answer: 'Hey! Ask me about live TV, new releases, movies, series, seedbox downloads, Argon lines, bookmarks, or system status.' };

  // Try LLM classification first (if OpenRouter is configured)
  const llmResult = await llmClassify(message);
  if (llmResult) {
    if (llmResult.tool) {
      const tool = tools.find((t) => t.name === llmResult.tool);
      if (tool) {
        return await tool.fn(llmResult.message || message);
      }
    }
    if (llmResult.answer) return { answer: llmResult.answer };
    if (llmResult.search) {
      const fq = fuzzyLike(llmResult.search);
      const now = Math.floor(Date.now() / 1000);
      const rssRows = db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE title LIKE ? ORDER BY pub_date DESC LIMIT 10').all(fq);
      const epgRows = db.prepare('SELECT c.name as channel, p.title, p.start, p.stop FROM epg_programmes p JOIN iptv_channels c ON p.channel_id = c.epg_id WHERE p.title LIKE ? AND p.stop > ? ORDER BY p.start LIMIT 10').all(fq, now);
      const items = [];
      if (rssRows.length) {
        items.push({ text: `**Releases matching "${llmResult.search}":**`, nav: null });
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
      if (items.length) return { answer: `Found results for "${llmResult.search}":`, items };
    }
  }

  // Fallback: keyword matching (if LLM unavailable or returned nothing useful)
  const lower = message.toLowerCase();
  for (const tool of tools) {
    if (tool.keywords.some((kw) => lower.includes(kw))) {
      return await tool.fn(message);
    }
  }

  // Last resort: fuzzy search across RSS + EPG
  const cleanQ = message.replace(/\b(is|are|there|any|new|the|a|an|do|i|have|can|you|show|me|please|what|when|where|how|recently|episodes?|released|on|in|rss|seedbox|or)\b/gi, '').replace(/[?!.,]/g, '').trim();
  if (cleanQ.length >= 3) {
    const now = Math.floor(Date.now() / 1000);
    const fq = fuzzyLike(cleanQ);
    const rssRows = db.prepare('SELECT title, feed_name as source, category, pub_date FROM rss_items WHERE title LIKE ? ORDER BY pub_date DESC LIMIT 10').all(fq);
    const epgRows = db.prepare('SELECT c.name as channel, p.title, p.start, p.stop FROM epg_programmes p JOIN iptv_channels c ON p.channel_id = c.epg_id WHERE p.title LIKE ? AND p.stop > ? ORDER BY p.start LIMIT 10').all(fq, now);
    const items = [];
    if (rssRows.length) rssRows.forEach((r) => items.push({
      text: `• **${r.title}** — _${r.source}_ • ${fmtAgo(r.pub_date)}`,
      nav: { page: 'news', search: r.title.split(/\s+/).slice(0, 3).join(' ') },
    }));
    if (epgRows.length) epgRows.forEach((r) => items.push({
      text: `• **${r.channel}** — ${r.title} at ${fmtTime(r.start)}`,
      nav: { page: 'livetv', search: r.channel },
    }));
    if (items.length) return { answer: `Found results for "${cleanQ}":`, items };
  }

  return { answer: 'I couldn\'t find anything for that. Try asking about new movies, TV series, seedbox downloads, Argon lines, bookmarks, or system status.' };
}

export { tools };
