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
    const rawSubs = (part.Stream || []).filter((s) => s.streamType === 3);
    const subtitles = rawSubs
      .filter((s) => ['srt', 'ass', 'ssa', 'subrip', 'vtt', 'text'].includes(s.codec))
      .map((s) => {
        // Use key if available, otherwise use Plex subtitle extraction endpoint
        const subUrl = s.key
          ? `/api/plex/thumb?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(s.key)}`
          : `/api/plex/subtitle?server=${encodeURIComponent(serverUrl)}&partId=${part.id}&streamId=${s.id}&ratingKey=${req.params.id}`;
        return {
          id: s.id,
          language: s.language || s.languageCode || 'Unknown',
          code: s.languageCode || '',
          title: s.displayTitle || s.language || 'Unknown',
          codec: s.codec,
          url: subUrl,
        };
      });

    // Transcoded stream URL (audio → AAC, video direct-stream when possible)
    const transcodeUrl = `/api/plex/stream?server=${encodeURIComponent(serverUrl)}&id=${req.params.id}&mode=transcode`;
    // Direct stream URL (no transcode — works if audio is browser-compatible)
    const directUrl = part.key ? `/api/plex/stream?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(part.key)}&mode=direct` : null;

    // Check if audio needs transcoding
    const audioStream = (part.Stream || []).find((s) => s.streamType === 2);
    const audioCodec = audioStream?.codec || '';
    const needsTranscode = !['aac', 'mp3', 'opus', 'flac'].includes(audioCodec);

    res.json({
      title: item.title,
      episode: item.type === 'episode' ? `S${String(item.parentIndex).padStart(2, '0')}E${String(item.index).padStart(2, '0')}` : null,
      showTitle: item.grandparentTitle || null,
      duration: item.duration || 0,
      streamUrl: needsTranscode ? transcodeUrl : (directUrl || transcodeUrl),
      subtitles,
      thumb: item.thumb ? `/api/plex/thumb?server=${encodeURIComponent(serverUrl)}&path=${encodeURIComponent(item.thumb)}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/plex/subtitle — extract embedded subtitle ───────────────────────
router.get('/subtitle', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const { server: serverUrl, partId, streamId, ratingKey } = req.query;
    if (!token || !serverUrl || !streamId) return res.status(400).json({ error: 'missing params' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    // Try multiple Plex API paths
    const urls = [
      partId && `${serverUrl}/library/parts/${partId}/subtitles?format=srt&selectedStreamID=${streamId}&X-Plex-Token=${token}`,
      `${serverUrl}/library/streams/${streamId}?X-Plex-Token=${token}`,
    ].filter(Boolean);

    let text = null;
    for (const url of urls) {
      try {
        console.log(`[plex] Trying subtitle URL: ${url.slice(0, 100)}...`);
        const subRes = await fetch(url, {
          agent: serverUrl.startsWith('https') ? agent : undefined,
          signal: controller.signal,
        });
        if (subRes.ok) {
          text = await subRes.text();
          if (text && text.length > 10) break;
        }
      } catch (e) {
        console.log(`[plex] Subtitle URL failed: ${e.message}`);
      }
    }
    clearTimeout(timer);

    if (!text) return res.status(404).json({ error: 'Could not extract subtitle' });

    // Convert to VTT
    if (!text.startsWith('WEBVTT')) {
      if (text.includes('[Script Info]') || text.includes('Dialogue:')) {
        text = assToVtt(text);
      } else {
        text = srtToVtt(text);
      }
    }

    console.log(`[plex] Subtitle extracted: ${text.length} chars`);
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(text);
  } catch (err) {
    console.error('[plex] subtitle error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

function srtToVtt(srt) {
  let vtt = 'WEBVTT\n\n';
  vtt += srt.replace(/\r\n/g, '\n').replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4').replace(/^\d+\n/gm, '');
  return vtt;
}

function assToVtt(ass) {
  let vtt = 'WEBVTT\n\n';
  for (const line of ass.split('\n')) {
    const m = line.match(/^Dialogue:\s*\d+,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),[^,]*,[^,]*,\d+,\d+,\d+,[^,]*,(.*)/);
    if (!m) continue;
    const start = m[1].replace(/^(\d):/, '0$1:') + '0';
    const end = m[2].replace(/^(\d):/, '0$1:') + '0';
    const text = m[3].replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
    if (text) vtt += `${start} --> ${end}\n${text}\n\n`;
  }
  return vtt;
}

// ── GET /api/plex/stream ─────────────────────────────────────────────────────
// mode=direct: proxy raw file with Range support
// mode=transcode: use Plex transcoder (audio→AAC, video direct-stream)
router.get('/stream', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const { server: serverUrl, path, id, mode } = req.query;
    if (!token || !serverUrl) return res.status(400).end();

    let url;
    const headers = {};

    if (mode === 'transcode' && id) {
      const params = new URLSearchParams({
        path: `/library/metadata/${id}`,
        mediaIndex: '0',
        partIndex: '0',
        protocol: 'http',
        directPlay: '0',
        directStream: '1',
        videoQuality: '100',
        maxVideoBitrate: '40000',
        audioBoost: '100',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'mediavault',
        'X-Plex-Product': 'MediaVault',
        'X-Plex-Platform': 'Chrome',
      });
      url = `${serverUrl}/video/:/transcode/universal/start.mkv?${params}`;
    } else if (path) {
      url = `${serverUrl}${path}?X-Plex-Token=${token}`;
      headers['X-Plex-Token'] = token;
      if (req.headers.range) headers.Range = req.headers.range;
    } else {
      return res.status(400).end();
    }

    const streamRes = await fetch(url, {
      headers,
      agent: serverUrl.startsWith('https') ? agent : undefined,
    });

    res.status(streamRes.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      if (streamRes.headers.get(h)) res.set(h, streamRes.headers.get(h));
    }
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
