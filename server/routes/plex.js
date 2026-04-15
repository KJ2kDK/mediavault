import { Router } from 'express';
import fetch from 'node-fetch';
import https from 'https';
import { spawn, execSync } from 'child_process';
import { mkdirSync, readFileSync, existsSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import db from '../db/index.js';

const router = Router();
const agent = new https.Agent({ rejectUnauthorized: false });

// ── Subtitle cache helpers ──────────────────────────────────────────────────
function subCacheKey(serverUrl, partId, streamId) {
  return `${serverUrl}:${partId}:${streamId}`;
}

function getCachedSub(serverUrl, partId, streamId) {
  const key = subCacheKey(serverUrl, partId, streamId);
  const row = db.prepare('SELECT vtt FROM subtitle_cache WHERE key = ?').get(key);
  return row?.vtt || null;
}

function setCachedSub(serverUrl, partId, streamId, vtt) {
  const key = subCacheKey(serverUrl, partId, streamId);
  db.prepare('INSERT OR REPLACE INTO subtitle_cache (key, vtt, created_at) VALUES (?, ?, unixepoch())').run(key, vtt);
}

// In-flight extraction tracker — prevents duplicate FFmpeg jobs for the same track
const extractionInFlight = new Map(); // key → Promise<string|null>

// ── FFmpeg detection ─────────────────────────────────────────────────────────
let FFMPEG_PATH = 'ffmpeg';
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  console.log('[plex] FFmpeg found in PATH');
} catch {
  // Common Windows paths
  const winPaths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  ];
  for (const p of winPaths) {
    try { execSync(`"${p}" -version`, { stdio: 'ignore' }); FFMPEG_PATH = p; break; } catch {}
  }
  if (FFMPEG_PATH === 'ffmpeg') console.warn('[plex] FFmpeg not found — remuxing disabled, will fall back to Plex transcode');
}

// Browser-compatible codecs
const BROWSER_VIDEO = new Set(['h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis', 'ac3', 'eac3']);
const BROWSER_CONTAINERS = new Set(['mp4', 'mov', 'webm']);
// Audio codecs safe for copy into fragmented MP4 (empty_moov).
// AC3/EAC3 cause "Cannot write moov atom before EAC3 packets parsed" so must be transcoded during remux.
const REMUX_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis']);

// Determine playback strategy for a given media file
function analyzePlayback(media, part) {
  const container = (media.container || '').toLowerCase();
  const videoStream = (part.Stream || []).find((s) => s.streamType === 1);
  const audioStream = (part.Stream || []).find((s) => s.streamType === 2);
  const videoCodec = (videoStream?.codec || '').toLowerCase();
  const audioCodec = (audioStream?.codec || '').toLowerCase();

  const info = {
    container,
    videoCodec,
    audioCodec,
    resolution: media.width && media.height ? `${media.width}x${media.height}` : null,
    bitrate: media.bitrate ? `${Math.round(media.bitrate / 1000)}Mbps` : null,
    audioChannels: audioStream?.channels || 2,
  };

  // Case 1: Already browser-compatible container + codecs → direct play
  if (BROWSER_CONTAINERS.has(container) && BROWSER_VIDEO.has(videoCodec) && BROWSER_AUDIO.has(audioCodec)) {
    return { ...info, mode: 'direct', reason: 'File is browser-compatible — playing original' };
  }

  // Case 2: Compatible codecs AND audio safe for fMP4 remux → container change only
  if (BROWSER_VIDEO.has(videoCodec) && REMUX_SAFE_AUDIO.has(audioCodec)) {
    return { ...info, mode: 'remux', reason: `Remuxing ${container.toUpperCase()}→MP4 — original quality preserved` };
  }

  // Case 3: Compatible video but audio needs transcode (AC3/EAC3/DTS/TrueHD etc.)
  if (BROWSER_VIDEO.has(videoCodec)) {
    return { ...info, mode: 'remux-audio', reason: `Original video, transcoding ${audioCodec.toUpperCase()} audio→AAC` };
  }

  // Case 4: Incompatible video → full transcode via Plex HLS
  return { ...info, mode: 'transcode', reason: `${videoCodec.toUpperCase()} needs full transcode` };
}

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

// Trigger Plex library scan on all servers, then return refreshed library data
router.post('/refresh', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    if (!token) return res.status(400).json({ error: 'No Plex token configured' });

    const servers = await discoverServers(token);
    const scanned = [];

    for (const server of servers) {
      try {
        const data = await plexFetch('/library/sections', token, server.url);
        const sections = data.MediaContainer?.Directory || [];
        for (const section of sections) {
          // Trigger a scan for each library section
          await fetch(`${server.url}/library/sections/${section.key}/refresh?X-Plex-Token=${token}`, {
            method: 'GET',
            agent: server.url.startsWith('https') ? agent : undefined,
          });
          scanned.push({ server: server.name, section: section.title });
        }
      } catch (err) {
        console.error(`[plex] refresh ${server.name}: ${err.message}`);
      }
    }

    console.log(`[plex] Triggered scan on ${scanned.length} sections`);

    // Wait a moment for Plex to start processing, then return fresh library data
    await new Promise((r) => setTimeout(r, 2000));

    // Clear server cache to force re-discovery
    serversCache = null;

    // Re-fetch the library
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
            if (items.length > 0) library[`${section.title} — ${server.name}`] = items;
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
      } catch {}
    }

    res.json({ scanned, library });
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
    const textSubs = rawSubs.filter((s) => ['srt', 'ass', 'ssa', 'subrip', 'vtt', 'text'].includes(s.codec));

    // Track language occurrences to label duplicates with distinguishing info
    const langCount = {};
    for (const s of textSubs) {
      const lang = s.language || s.languageCode || 'Unknown';
      langCount[lang] = (langCount[lang] || 0) + 1;
    }
    const langSeen = {};

    const subtitles = textSubs.map((s) => {
      const lang = s.language || s.languageCode || 'Unknown';
      langSeen[lang] = (langSeen[lang] || 0) + 1;

      // Build a descriptive title that distinguishes duplicate languages
      let title = s.displayTitle || lang;
      if (langCount[lang] > 1) {
        // Add distinguishing details: forced, SDH, codec, or track number
        const tags = [];
        if (s.forced) tags.push('Forced');
        if (s.hearingImpaired || (s.displayTitle && /sdh|hearing/i.test(s.displayTitle))) tags.push('SDH');
        if (s.title && s.title !== s.displayTitle) tags.push(s.title);
        if (tags.length === 0) tags.push(`Track ${langSeen[lang]}`);
        title = `${lang} (${tags.join(', ')})`;
      }

      // FFmpeg subtitle index = position of this stream among ALL subtitle streams (including non-text)
      const ffmpegSubIdx = rawSubs.findIndex((rs) => rs.id === s.id);
      const subUrl = `/api/plex/subtitle?server=${encodeURIComponent(serverUrl)}&partId=${part.id}&streamId=${s.id}&ratingKey=${req.params.id}&subIndex=${ffmpegSubIdx >= 0 ? ffmpegSubIdx : 0}&codec=${s.codec}&path=${encodeURIComponent(part.key)}`;
      return {
        id: s.id,
        language: lang,
        code: s.languageCode || '',
        title,
        codec: s.codec,
        url: subUrl,
      };
    });

    // Analyze what the file needs for browser playback
    const playback = analyzePlayback(media, part);
    const enc = (s) => encodeURIComponent(s);
    const partPath = part.key;

    let streamUrl;
    if (playback.mode === 'direct') {
      // Original file, zero processing
      streamUrl = `/api/plex/stream?server=${enc(serverUrl)}&path=${enc(partPath)}&mode=direct`;
    } else if (playback.mode === 'remux' && FFMPEG_PATH) {
      // FFmpeg remux only — container change, original video+audio bits preserved
      streamUrl = `/api/plex/stream?server=${enc(serverUrl)}&path=${enc(partPath)}&mode=remux`;
    } else if (playback.mode === 'remux-audio' && FFMPEG_PATH) {
      // FFmpeg remux + audio transcode only — original video preserved
      streamUrl = `/api/plex/stream?server=${enc(serverUrl)}&path=${enc(partPath)}&mode=remux-audio&channels=${playback.audioChannels}`;
    } else {
      // Fall back to Plex HLS transcode (FFmpeg not available or incompatible video)
      streamUrl = `/api/plex/stream?server=${enc(serverUrl)}&id=${req.params.id}&mode=transcode`;
    }

    console.log(`[plex] Play ${item.title}: ${playback.mode} — ${playback.reason}`);

    res.json({
      title: item.title,
      episode: item.type === 'episode' ? `S${String(item.parentIndex).padStart(2, '0')}E${String(item.index).padStart(2, '0')}` : null,
      showTitle: item.grandparentTitle || null,
      duration: item.duration || 0,
      streamUrl,
      playbackMode: playback.mode,
      playbackReason: playback.reason,
      container: playback.container,
      videoCodec: playback.videoCodec,
      audioCodec: playback.audioCodec,
      resolution: playback.resolution,
      bitrate: playback.bitrate,
      subtitles,
      thumb: item.thumb ? `/api/plex/thumb?server=${enc(serverUrl)}&path=${enc(item.thumb)}` : null,
    });

    // ── Background pre-extract ALL subtitle tracks so switching mid-movie is instant ──
    const subTracksForPreExtract = textSubs.map((s) => {
      const ffmpegSubIdx = rawSubs.findIndex((rs) => rs.id === s.id);
      return {
        streamId: String(s.id),
        subIndex: ffmpegSubIdx >= 0 ? ffmpegSubIdx : 0,
        codec: s.codec,
      };
    });
    preExtractSubtitles(serverUrl, String(part.id), partPath, subTracksForPreExtract);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Single-pass FFmpeg extraction: reads the file ONCE, extracts ALL subtitle tracks ──
// This is critical for large files (4.8GB+) — avoids downloading the file N times for N tracks.
let bulkExtractionInFlight = null; // Promise for the current bulk extraction job

function extractAllSubtitlesFFmpeg(serverUrl, partPath, subtitleTracks) {
  const token = process.env.PLEX_TOKEN;
  const inputUrl = `${serverUrl}${partPath}?X-Plex-Token=${token}`;
  const tempDir = join(tmpdir(), `mediavault-subs-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-probesize', '50000000',         // 50 MB probe window
      '-analyzeduration', '10000000',   // 10 seconds analysis
      '-i', inputUrl,
    ];

    // Map each subtitle track to its own output file
    const outputMap = []; // { streamId, subIndex, codec, filePath }
    for (const track of subtitleTracks) {
      const outFormat = (track.codec === 'ass' || track.codec === 'ssa') ? 'ass' : 'srt';
      const outExt = outFormat;
      const filePath = join(tempDir, `sub_${track.subIndex}.${outExt}`);
      args.push('-map', `0:s:${track.subIndex}`, '-c:s', 'copy');
      args.push(filePath);
      outputMap.push({ ...track, filePath, outFormat });
    }

    console.log(`[plex] FFmpeg bulk subtitle extract: ${subtitleTracks.length} tracks → ${tempDir}`);
    const ffmpeg = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrBuf = '';
    ffmpeg.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 3000) stderrBuf = stderrBuf.slice(-2000);
    });

    ffmpeg.on('close', (code) => {
      // Even if FFmpeg exits non-zero, some files may have been written successfully
      const results = [];
      for (const entry of outputMap) {
        try {
          if (existsSync(entry.filePath)) {
            const raw = readFileSync(entry.filePath, 'utf-8');
            if (raw.length > 10) {
              results.push({ streamId: entry.streamId, codec: entry.codec, raw });
            }
          }
        } catch {}
      }

      // Cleanup temp files
      try {
        for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f));
        rmdirSync(tempDir);
      } catch {}

      if (results.length > 0) {
        console.log(`[plex] FFmpeg bulk extract: ${results.length}/${subtitleTracks.length} tracks extracted (exit code ${code})`);
        resolve(results);
      } else {
        reject(new Error(`FFmpeg bulk subtitle extract failed (code ${code}): ${stderrBuf.slice(-300)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      try {
        for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f));
        rmdirSync(tempDir);
      } catch {}
      reject(err);
    });

    // Hard timeout: 300s for bulk extraction (reading large file once)
    setTimeout(() => {
      if (!ffmpeg.killed) {
        console.log(`[plex] FFmpeg bulk subtitle timeout (300s) — killing`);
        ffmpeg.kill('SIGTERM');
      }
    }, 300000);
  });
}

// Convert raw subtitle text to VTT and cache it
function convertAndCache(serverUrl, partId, streamId, codec, rawText) {
  let text = rawText;
  if (!text.startsWith('WEBVTT')) {
    if (text.includes('[Script Info]') || text.includes('Dialogue:')) {
      text = assToVtt(text);
    } else {
      text = srtToVtt(text);
    }
  }
  setCachedSub(serverUrl, partId, streamId, text);
  return text;
}

// Background pre-extraction: ONE FFmpeg pass extracts ALL subtitle tracks
function preExtractSubtitles(serverUrl, partId, partPath, subtitleTracks) {
  if (!FFMPEG_PATH || !partPath || !subtitleTracks?.length) return;

  // Skip if a bulk extraction is already running
  if (bulkExtractionInFlight) {
    console.log(`[plex] Bulk subtitle extraction already in-flight — skipping duplicate`);
    return;
  }

  // Skip if all tracks are already cached
  const uncached = subtitleTracks.filter((t) => !getCachedSub(serverUrl, partId, t.streamId));
  if (uncached.length === 0) {
    console.log(`[plex] All ${subtitleTracks.length} subtitle tracks already cached`);
    return;
  }

  console.log(`[plex] Pre-extracting ${uncached.length} uncached subtitle tracks (of ${subtitleTracks.length} total) in single FFmpeg pass...`);

  // Store promise so subtitle endpoint can wait on it
  const promise = (async () => {
    try {
      const results = await extractAllSubtitlesFFmpeg(serverUrl, partPath, uncached);
      for (const r of results) {
        convertAndCache(serverUrl, partId, r.streamId, r.codec, r.raw);
      }
      console.log(`[plex] Background pre-extraction complete: ${results.length} tracks cached`);
    } catch (e) {
      console.error(`[plex] Background pre-extraction failed: ${e.message}`);
    } finally {
      bulkExtractionInFlight = null;
    }
  })();

  bulkExtractionInFlight = promise;
}

// Single track extraction fallback (used if bulk extraction failed or not started)
function extractSingleSubtitleFFmpeg(serverUrl, partPath, subIndex, codec) {
  const token = process.env.PLEX_TOKEN;
  const inputUrl = `${serverUrl}${partPath}?X-Plex-Token=${token}`;
  const outFormat = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'srt';

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-probesize', '50000000',
      '-analyzeduration', '10000000',
      '-i', inputUrl,
      '-map', `0:s:${subIndex || 0}`,
      '-c:s', 'copy',
      '-f', outFormat,
      'pipe:1',
    ];

    const ffmpeg = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let lastDataAt = Date.now();

    ffmpeg.stdout.on('data', (d) => { out += d.toString(); lastDataAt = Date.now(); });
    ffmpeg.stderr.on('data', (d) => { err += d.toString(); });

    ffmpeg.on('close', (code) => {
      if (out.length > 10) resolve(out);
      else reject(new Error(`FFmpeg single subtitle extract failed (code ${code}): ${err.slice(0, 300)}`));
    });
    ffmpeg.on('error', reject);

    // 180s hard timeout + idle kill
    const hardTimeout = setTimeout(() => { if (!ffmpeg.killed) ffmpeg.kill('SIGTERM'); }, 180000);
    const idleCheck = setInterval(() => {
      if (out.length > 50 && Date.now() - lastDataAt > 8000) {
        clearTimeout(hardTimeout);
        ffmpeg.kill('SIGTERM');
      }
    }, 2000);
    ffmpeg.on('close', () => { clearTimeout(hardTimeout); clearInterval(idleCheck); });
  });
}

// ── GET /api/plex/subtitle — extract embedded subtitle ───────────────────────
router.get('/subtitle', async (req, res) => {
  try {
    const token = process.env.PLEX_TOKEN;
    const { server: serverUrl, partId, streamId, ratingKey, subIndex, codec, path: partPath } = req.query;
    console.log(`[plex] Subtitle request: streamId=${streamId}, subIndex=${subIndex}, codec=${codec}`);
    if (!token || !serverUrl || !streamId) return res.status(400).json({ error: 'missing params' });

    if (!FFMPEG_PATH || !partPath) {
      return res.status(501).json({ error: 'FFmpeg required for embedded subtitle extraction' });
    }

    // 1. Check cache first (instant)
    let vtt = getCachedSub(serverUrl, partId, streamId);
    if (vtt) {
      console.log(`[plex] Subtitle cache HIT: streamId=${streamId}`);
      res.set('Content-Type', 'text/vtt; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(vtt);
    }

    // 2. If bulk extraction is in-flight, wait for it (it reads the file once for ALL tracks)
    if (bulkExtractionInFlight) {
      console.log(`[plex] Waiting for bulk extraction to complete for streamId=${streamId}...`);
      await bulkExtractionInFlight;
      // Check cache again — bulk extraction should have populated it
      vtt = getCachedSub(serverUrl, partId, streamId);
      if (vtt) {
        console.log(`[plex] Subtitle available after bulk extraction: streamId=${streamId}`);
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(vtt);
      }
    }

    // 3. Fallback: single-track extraction (shouldn't normally reach here)
    console.log(`[plex] Single-track fallback extraction for streamId=${streamId}`);
    try {
      let rawText = await extractSingleSubtitleFFmpeg(serverUrl, partPath, subIndex, codec);
      if (rawText && rawText.length > 10) {
        vtt = convertAndCache(serverUrl, partId, streamId, codec, rawText);
      }
    } catch (e) {
      console.error(`[plex] Single-track extraction failed: ${e.message}`);
    }

    if (!vtt) return res.status(404).json({ error: 'Could not extract subtitle' });

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
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
// mode=direct:      proxy raw file with Range support (browser-compatible MP4)
// mode=remux:       FFmpeg remux only — container MKV→fMP4, original codecs preserved
// mode=remux-audio: FFmpeg remux + audio transcode (DTS/TrueHD→AAC), video untouched
// mode=transcode:   Plex HLS transcode fallback (for truly incompatible video codecs)
// mode=segment:     proxy individual HLS segment for transcode mode
router.get('/stream', async (req, res) => {
  const token = process.env.PLEX_TOKEN;
  const { server: serverUrl, path, id, mode, start, channels } = req.query;
  if (!token || !serverUrl) return res.status(400).end();

  try {
    // ── Direct play — proxy raw file, supports Range for seeking ─────────
    if (mode === 'direct' && path) {
      const url = `${serverUrl}${path}?X-Plex-Token=${token}`;
      const headers = { 'X-Plex-Token': token };
      if (req.headers.range) headers.Range = req.headers.range;

      const streamRes = await fetch(url, {
        headers,
        agent: serverUrl.startsWith('https') ? agent : undefined,
      });

      res.status(streamRes.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (streamRes.headers.get(h)) res.set(h, streamRes.headers.get(h));
      }
      streamRes.body.pipe(res);
      return;
    }

    // ── FFmpeg remux — original quality, just change container ───────────
    if ((mode === 'remux' || mode === 'remux-audio') && path) {
      const inputUrl = `${serverUrl}${path}?X-Plex-Token=${token}`;

      const args = [
        '-hide_banner', '-loglevel', 'warning',
      ];

      const seekSec = start && Number(start) > 0 ? Number(start) : 0;

      if (seekSec > 0 && mode === 'remux') {
        // Remux (audio copy): fast seek before -i is fine since both streams are copied
        args.push('-ss', String(seekSec));
      }

      args.push('-i', inputUrl);

      if (seekSec > 0 && mode === 'remux-audio') {
        // Remux-audio (audio transcode): seek AFTER -i for accurate A/V sync
        // Fast seek before -i can land on a different keyframe for video vs audio
        args.push('-ss', String(seekSec));
      }

      args.push('-c:v', 'copy');              // Video: always copy (original quality)

      if (mode === 'remux-audio') {
        // Audio needs transcode (DTS/TrueHD → AAC)
        args.push(
          '-c:a', 'aac',
          '-b:a', '320k',                   // High quality AAC
          '-ac', String(channels || 2),      // Preserve channel count if stereo, downmix if surround
          '-async', '1',                     // Sync audio to video timestamps after seek
        );
      } else {
        args.push('-c:a', 'copy');           // Audio: copy original
      }

      args.push(
        '-map', '0:v:0',                    // Map only first video stream
        '-map', '0:a:0',                    // Map only first audio stream
        '-sn',                               // Skip subtitles (handled via separate subtitle endpoint)
        '-f', 'mp4',                         // Output: MP4 container
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',  // Fragmented MP4 for streaming
        'pipe:1',                            // Pipe to stdout
      );

      console.log(`[plex] FFmpeg ${mode}: ${FFMPEG_PATH} ${args.slice(-6).join(' ')}`);

      const ffmpeg = spawn(FFMPEG_PATH, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Log stderr for debugging
      let stderrBuf = '';
      ffmpeg.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-1000);
      });

      ffmpeg.on('error', (err) => {
        console.error(`[plex] FFmpeg spawn error: ${err.message}`);
        if (!res.headersSent) res.status(500).json({ error: 'FFmpeg not available' });
      });

      ffmpeg.on('close', (code) => {
        if (code && code !== 0 && code !== 255) {
          console.error(`[plex] FFmpeg exited ${code}: ${stderrBuf.slice(-500)}`);
        }
      });

      // Client disconnected — kill FFmpeg
      req.on('close', () => {
        if (!ffmpeg.killed) ffmpeg.kill('SIGTERM');
      });

      res.set('Content-Type', 'video/mp4');
      res.set('Transfer-Encoding', 'chunked');
      ffmpeg.stdout.pipe(res);
      return;
    }

    // ── Plex HLS transcode fallback (incompatible video codecs) ──────────
    if (mode === 'transcode' && id) {
      const params = new URLSearchParams({
        path: `/library/metadata/${id}`,
        mediaIndex: '0',
        partIndex: '0',
        protocol: 'hls',
        directPlay: '0',
        directStream: '0',
        directStreamAudio: '0',
        videoQuality: '100',
        maxVideoBitrate: '40000',
        audioBoost: '100',
        subtitles: 'none',
        copyts: '1',
        hasMDE: '1',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'mediavault',
        'X-Plex-Product': 'MediaVault',
        'X-Plex-Platform': 'Chrome',
      });
      const hlsUrl = `${serverUrl}/video/:/transcode/universal/start.m3u8?${params}`;

      const hlsRes = await fetch(hlsUrl, {
        agent: serverUrl.startsWith('https') ? agent : undefined,
      });

      if (!hlsRes.ok) return res.status(hlsRes.status).end();

      const contentType = hlsRes.headers.get('content-type') || '';

      if (contentType.includes('mpegurl') || contentType.includes('m3u')) {
        let body = await hlsRes.text();
        const proxyBase = `/api/plex/stream?server=${encodeURIComponent(serverUrl)}&mode=segment&path=`;

        body = body.replace(new RegExp(serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(/[^\\s]+)', 'g'), (_, p) => {
          return `${proxyBase}${encodeURIComponent(p)}`;
        });

        body = body.split('\n').map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('http')) return line;
          const resolved = trimmed.startsWith('/') ? trimmed : `/video/:/transcode/universal/${trimmed}`;
          return `${proxyBase}${encodeURIComponent(resolved)}`;
        }).join('\n');

        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(body);
      }

      res.status(hlsRes.status);
      for (const h of ['content-type', 'content-length']) {
        if (hlsRes.headers.get(h)) res.set(h, hlsRes.headers.get(h));
      }
      hlsRes.body.pipe(res);
      return;
    }

    // ── HLS segment proxy ────────────────────────────────────────────────
    if (mode === 'segment' && path) {
      const segUrl = `${serverUrl}${path}${path.includes('?') ? '&' : '?'}X-Plex-Token=${token}`;
      const segRes = await fetch(segUrl, {
        agent: serverUrl.startsWith('https') ? agent : undefined,
      });
      res.status(segRes.status);
      for (const h of ['content-type', 'content-length']) {
        if (segRes.headers.get(h)) res.set(h, segRes.headers.get(h));
      }
      segRes.body.pipe(res);
      return;
    }

    res.status(400).end();
  } catch (err) {
    console.error('[plex] stream error:', err.message);
    if (!res.headersSent) res.status(502).end();
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
