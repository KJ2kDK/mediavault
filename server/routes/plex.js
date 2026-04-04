import { Router } from 'express';
import fetch from 'node-fetch';
import https from 'https';

const router = Router();
const agent = new https.Agent({ rejectUnauthorized: false });

const plexFetch = async (path, token, serverUrl) => {
  const url = `${serverUrl}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Plex-Token': token, Accept: 'application/json' },
    agent: serverUrl.startsWith('https') ? agent : undefined,
  });
  if (!res.ok) throw new Error(`Plex API error: ${res.status}`);
  return res.json();
};

// Discover all Plex servers linked to the account
let serversCache = null;
let serversCacheAt = 0;

async function discoverServers(token) {
  if (serversCache && Date.now() - serversCacheAt < 300_000) return serversCache;
  const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0', {
    headers: {
      'X-Plex-Token': token,
      'X-Plex-Client-Identifier': 'mediavault',
      'X-Plex-Product': 'MediaVault',
      'X-Plex-Version': '1.0.0',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Plex.tv API error: ${res.status}`);
  const resources = await res.json();
  const servers = resources
    .filter((r) => r.provides === 'server' && r.connections?.length)
    .map((r) => {
      // Prefer local HTTPS, then remote HTTPS
      const conn = r.connections.find((c) => c.local && c.protocol === 'https')
        || r.connections.find((c) => c.protocol === 'https')
        || r.connections[0];
      return { name: r.name, machineId: r.clientIdentifier, url: conn.uri };
    });
  console.log(`[plex] Discovered ${servers.length} servers:`, servers.map((s) => `${s.name} → ${s.url}`));
  // Filter to WhudBox only — SHIELD is managed separately
  const filtered = servers.filter((s) => s.name !== 'SHIELD Android TV');
  serversCache = filtered.length ? filtered : servers;
  serversCacheAt = Date.now();
  return servers;
}

// ── GET /api/plex/servers ────────────────────────────────────────────────────
router.get('/servers', async (_req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    if (!token) return res.json({ servers: [] });
    const servers = await discoverServers(token);
    res.json({ servers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection
router.get('/test', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    if (!token) return res.json({ success: false, error: 'Not configured' });
    const servers = await discoverServers(token);
    res.json({ success: true, servers: servers.map((s) => s.name) });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get library contents from ALL servers
router.get('/library', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    if (!token) return res.json(null);

    const servers = await discoverServers(token);
    const library = {};

    for (const server of servers) {
      try {
        const sectionsData = await plexFetch('/library/sections', token, server.url);
        const sections = sectionsData.MediaContainer?.Directory || [];

        for (const section of sections) {
          try {
            const recent = await plexFetch(
              `/library/sections/${section.key}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=15`,
              token, server.url
            );
            const items = (recent.MediaContainer?.Metadata || []).map((m) => mapPlexItem(m, server));
            if (items.length > 0) {
              library[`${section.title} — ${server.name}`] = items;
            }
          } catch {}

          try {
            const onDeck = await plexFetch(
              `/library/sections/${section.key}/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=15`,
              token, server.url
            );
            const items = (onDeck.MediaContainer?.Metadata || []).map((m) => mapPlexItem(m, server));
            if (items.length > 0) {
              const key = `Continue Watching — ${server.name}`;
              library[key] = [...(library[key] || []), ...items];
            }
          } catch {}
        }
      } catch (err) {
        console.error(`[plex] ${server.name}: ${err.message}`);
      }
    }

    res.json(library);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all libraries (from all servers)
router.get('/libraries', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const servers = await discoverServers(token);
    const allSections = [];
    for (const server of servers) {
      try {
        const data = await plexFetch('/library/sections', token, server.url);
        for (const d of data.MediaContainer?.Directory || []) {
          allSections.push({ id: d.key, title: d.title, type: d.type, count: d.count || 0, server: server.name, machineId: server.machineId });
        }
      } catch {}
    }
    res.json({ sections: allSections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search across all servers
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const token = process.env.PLEX_TOKEN;
    const servers = await discoverServers(token);
    const results = [];
    for (const server of servers) {
      try {
        const data = await plexFetch(`/hubs/search?query=${encodeURIComponent(q)}&limit=20`, token, server.url);
        for (const hub of data.MediaContainer?.Hub || []) {
          for (const item of hub.Metadata || []) {
            results.push(mapPlexItem(item, server));
          }
        }
      } catch {}
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/plex/thumb?server=URL&path=/library/metadata/123/thumb ──────────
router.get('/thumb', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const { path, server } = req.query;
    if (!path || !token) return res.status(400).end();

    const serverUrl = server || process.env.PLEX_SERVER_URL;
    const imgUrl = `${serverUrl}${path}?X-Plex-Token=${token}`;
    const imgRes = await fetch(imgUrl, { agent: serverUrl.startsWith('https') ? agent : undefined });
    if (!imgRes.ok) return res.status(imgRes.status).end();

    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    imgRes.body.pipe(res);
  } catch {
    res.status(502).end();
  }
});

// ── GET /api/plex/play/:id?server=URL ────────────────────────────────────────
// Returns stream URL, subtitle tracks, and metadata for in-app playback
router.get('/play/:id', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const serverUrl = req.query.server;
    if (!token || !serverUrl) return res.status(400).json({ error: 'server param required' });

    const meta = await plexFetch(`/library/metadata/${req.params.id}`, token, serverUrl);
    const item = meta.MediaContainer?.Metadata?.[0];
    if (!item) return res.status(404).json({ error: 'Not found' });

    const media = item.Media?.[0];
    const part = media?.Part?.[0];
    if (!part) return res.status(404).json({ error: 'No media part' });

    // Subtitle streams from the file
    const subtitles = (part.Stream || [])
      .filter((s) => s.streamType === 3)
      .map((s) => ({
        id: s.id,
        language: s.language || s.languageCode || 'Unknown',
        code: s.languageCode || '',
        title: s.displayTitle || s.language || 'Unknown',
        codec: s.codec,
        url: s.key ? `/api/plex/thumb?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(s.key)}` : null,
      }));

    // Direct stream URL (proxied through our backend with Range support)
    const streamUrl = part.key ? `/api/plex/stream?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(part.key)}` : null;

    res.json({
      title: item.title,
      episode: item.type === 'episode' ? `S${String(item.parentIndex).padStart(2, '0')}E${String(item.index).padStart(2, '0')}` : null,
      showTitle: item.grandparentTitle || null,
      duration: item.duration || 0,
      streamUrl,
      subtitles,
      thumb: item.thumb ? `/api/plex/thumb?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(item.thumb)}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/plex/stream?server=URL&path=/library/parts/... ──────────────────
// Proxy video stream with Range header support for seeking
router.get('/stream', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const { server: serverUrl, path } = req.query;
    if (!token || !serverUrl || !path) return res.status(400).end();

    const headers = { 'X-Plex-Token': token };
    if (req.headers.range) headers.Range = req.headers.range;

    const streamRes = await fetch(`${serverUrl}${path}?X-Plex-Token=${token}`, {
      headers,
      agent: serverUrl.startsWith('https') ? agent : undefined,
    });

    res.status(streamRes.status);
    if (streamRes.headers.get('content-type')) res.set('Content-Type', streamRes.headers.get('content-type'));
    if (streamRes.headers.get('content-length')) res.set('Content-Length', streamRes.headers.get('content-length'));
    if (streamRes.headers.get('content-range')) res.set('Content-Range', streamRes.headers.get('content-range'));
    if (streamRes.headers.get('accept-ranges')) res.set('Accept-Ranges', streamRes.headers.get('accept-ranges'));
    streamRes.body.pipe(res);
  } catch {
    res.status(502).end();
  }
});

function mapPlexItem(item, server) {
  return {
    id: item.ratingKey,
    title: item.title,
    year: item.year,
    rating: item.audienceRating || item.rating || null,
    type: item.type === 'show' || item.type === 'season' || item.type === 'episode' ? 'show' : 'movie',
    genre: item.Genre?.[0]?.tag || '',
    thumb: item.thumb ? `/api/plex/thumb?server=${encodeURIComponent(server.url)}&path=${encodeURIComponent(item.thumb)}` : null,
    progress: item.viewOffset ? Math.round((item.viewOffset / (item.duration || 1)) * 100) : 0,
    episode: item.type === 'episode' ? `S${String(item.parentIndex).padStart(2, '0')}E${String(item.index).padStart(2, '0')}` : null,
    description: item.summary || '',
    server: server.name,
    plexUrl: `https://app.plex.tv/desktop#!/server/${server.machineId}/details?key=${encodeURIComponent(`/library/metadata/${item.ratingKey}`)}`,
    serverUrl: server.url,
  };
}

export default router;
