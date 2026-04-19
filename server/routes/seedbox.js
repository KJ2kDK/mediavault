/**
 * Seedbox Streaming Routes
 *
 * Direct streaming from seedbox via SSH — no Plex dependency.
 * Handles: library browsing, playback analysis, streaming, subtitles.
 */

import { Router } from 'express';
import seedbox from '../services/seedbox.js';
import { scanLibrary, parseFilename, findExternalSubs } from '../services/scanner.js';
import tmdb from '../services/tmdb.js';
import db from '../db/index.js';

const router = Router();

// ── In-memory library cache (populated by scan) ────────────────────────────
let libraryCache = null;
let libraryCacheAt = 0;
let scanInProgress = false;

// Flat index for quick lookup by ID (path hash)
let mediaIndex = new Map(); // id → media item

/**
 * Generate a stable numeric ID from a file path.
 * Using a simple hash so IDs are consistent across scans.
 */
function pathToId(filePath) {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) - hash + filePath.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Run a full library scan, rebuild cache and index.
 */
async function refreshLibrary() {
  if (scanInProgress) return libraryCache;
  scanInProgress = true;

  try {
    console.log('[seedbox] Starting library scan...');
    const startTime = Date.now();
    const { movies, shows, stats } = await scanLibrary();

    // Build flat index
    const newIndex = new Map();

    // Process movies
    for (const movie of movies) {
      const id = pathToId(movie.path);
      movie.id = id;
      movie.mediaType = 'movie';
      newIndex.set(id, movie);
    }

    // Process shows → flatten to episodes for the index
    for (const [showTitle, show] of Object.entries(shows)) {
      for (const [seasonNum, episodes] of Object.entries(show.seasons)) {
        for (const ep of episodes) {
          const id = pathToId(ep.path);
          ep.id = id;
          ep.mediaType = 'episode';
          ep.showTitle = showTitle;
          newIndex.set(id, ep);
        }
      }
    }

    mediaIndex = newIndex;
    libraryCache = { movies, shows };
    libraryCacheAt = Date.now();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const cacheInfo = stats ? ` (${stats.scannedDirs} scanned, ${stats.cachedDirs} cached)` : '';
    console.log(`[seedbox] Scan complete: ${movies.length} movies, ${Object.keys(shows).length} shows (${elapsed}s)${cacheInfo}`);

    // Apply any manual overrides FIRST (user-selected TMDB matches)
    if (tmdb.isEnabled()) {
      applyManualOverrides().catch((e) => console.warn('[seedbox] Override apply failed:', e.message));
      // Then background TMDB auto-enrichment for anything without an override
      enrichWithTMDB(libraryCache).catch((e) => console.warn('[seedbox] TMDB enrichment failed:', e.message));
    }

    // Save scan stats to DB
    try {
      db.prepare('INSERT OR REPLACE INTO iptv_meta (key, value) VALUES (?, ?)').run(
        'seedbox_last_scan',
        String(Math.floor(Date.now() / 1000))
      );
    } catch {}

    return libraryCache;
  } finally {
    scanInProgress = false;
  }
}

// ── GET /api/seedbox/tmdb/search?q=...&type=movie|tv ──────────────────────
// Manual TMDB search for the "Fix Match" UI
router.get('/tmdb/search', async (req, res) => {
  try {
    if (!tmdb.isEnabled()) return res.status(503).json({ error: 'TMDB not configured' });
    const { q, type = 'movie' } = req.query;
    if (!q?.trim()) return res.json({ results: [] });
    const results = await tmdb.searchRaw(q.trim(), type === 'tv' ? 'tv' : 'movie', 12);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/seedbox/tmdb/match ──────────────────────────────────────────
// Body: { itemId, tmdbId, type } — manually assign a TMDB match
router.post('/tmdb/match', async (req, res) => {
  try {
    if (!tmdb.isEnabled()) return res.status(503).json({ error: 'TMDB not configured' });
    const { itemId, tmdbId, type } = req.body || {};
    if (!itemId || !tmdbId || !type) return res.status(400).json({ error: 'itemId, tmdbId, type required' });

    const meta = await tmdb.lookupById(tmdbId, type);
    if (!meta) return res.status(404).json({ error: 'TMDB item not found' });

    // Store override so it survives rescans
    db.prepare('INSERT OR REPLACE INTO seedbox_matches (item_id, tmdb_id, type) VALUES (?, ?, ?)')
      .run(Number(itemId), Number(tmdbId), type);

    // Apply immediately to in-memory index
    const targets = findMatchTargets(Number(itemId));
    for (const t of targets) applyTmdb(t, meta);

    res.json({ matched: meta, applied: targets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/seedbox/tmdb/match/:itemId ────────────────────────────────
// Clear a manual match — next scan will auto-match again
router.delete('/tmdb/match/:itemId', (req, res) => {
  try {
    const id = Number(req.params.itemId);
    db.prepare('DELETE FROM seedbox_matches WHERE item_id = ?').run(id);
    res.json({ cleared: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/seedbox/status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    connected: seedbox.isConnected(),
    config: seedbox.getConfig(),
    library: libraryCache ? {
      movies: libraryCache.movies.length,
      shows: Object.keys(libraryCache.shows).length,
      lastScan: libraryCacheAt ? new Date(libraryCacheAt).toISOString() : null,
    } : null,
  });
});

// ── POST /api/seedbox/scan ──────────────────────────────────────────────────
// Trigger a manual library rescan
router.post('/scan', async (req, res) => {
  try {
    if (!seedbox.isConnected()) return res.status(503).json({ error: 'Seedbox not connected' });
    const lib = await refreshLibrary();
    res.json({
      movies: lib.movies.length,
      shows: Object.keys(lib.shows).length,
    });
  } catch (err) {
    console.error('[seedbox] scan error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/seedbox/library ────────────────────────────────────────────────
// Returns the full library in the same shape the frontend expects
router.get('/library', async (req, res) => {
  try {
    if (!seedbox.isConnected()) return res.json({});

    // Scan on first request or if cache is stale (> 5 min)
    if (!libraryCache || Date.now() - libraryCacheAt > 5 * 60 * 1000) {
      await refreshLibrary();
    }

    if (!libraryCache) return res.json({});

    // Format like the Plex library response: { "Section Name": [items] }
    const library = {};

    // Continue Watching — items with saved progress that aren't ~finished.
    // Sourced from watch_history (populated by VideoPlayer auto-save every 10s).
    try {
      const rows = db.prepare(`
        SELECT item_id, progress, duration, watched_at
        FROM watch_history
        WHERE item_id LIKE 'seedbox:%'
          AND progress > 30
          AND (duration IS NULL OR duration = 0 OR progress < duration * 0.9)
        ORDER BY watched_at DESC
        LIMIT 20
      `).all();

      const continueItems = [];
      for (const row of rows) {
        const numId = Number(String(row.item_id).replace(/^seedbox:/, ''));
        const item = mediaIndex.get(numId);
        if (!item) continue; // item no longer in library (file moved/deleted)
        continueItems.push(formatMediaItem(item));
      }

      if (continueItems.length > 0) {
        library['Continue Watching'] = continueItems;
      }
    } catch (err) {
      console.warn('[seedbox] continue-watching query failed:', err.message);
    }

    // Movies section
    if (libraryCache.movies.length > 0) {
      library['Movies'] = libraryCache.movies
        .sort((a, b) => b.mtime - a.mtime)
        .map((m) => formatMediaItem(m));
    }

    // Shows — one card per show with season/episode counts
    const showCards = [];
    for (const [showTitle, show] of Object.entries(libraryCache.shows)) {
      const allEpisodes = Object.values(show.seasons).flat();
      const seasonCount = Object.keys(show.seasons).length;
      const episodeCount = allEpisodes.length;

      // Use the most recent episode as the representative item (for mtime sorting)
      const mostRecent = allEpisodes.sort((a, b) => b.mtime - a.mtime)[0];
      // Use S01E01 as the playable entry point
      const firstEp = allEpisodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return (a.episode || 0) - (b.episode || 0);
      })[0];

      showCards.push({
        ...formatMediaItem({ ...firstEp, showTitle }),
        episode: null,  // Don't show "S01E01" on the overview card
        seasonCount,
        episodeCount,
        subtitle: seasonCount > 1
          ? `${seasonCount} Seasons · ${episodeCount} Episodes`
          : `${episodeCount} Episodes`,
        mtime: mostRecent.mtime,
      });
    }

    if (showCards.length > 0) {
      library['Shows — Seedbox'] = showCards.sort((a, b) => b.mtime - a.mtime);
    }

    // Recently Added — most recent files, deduplicated by show
    const allItems = [...mediaIndex.values()]
      .sort((a, b) => b.mtime - a.mtime);

    const recentItems = [];
    const seenShows = new Set();
    for (const item of allItems) {
      if (recentItems.length >= 20) break;
      // For episodes, only show the most recent one per show
      if (item.showTitle) {
        if (seenShows.has(item.showTitle)) continue;
        seenShows.add(item.showTitle);
      }
      recentItems.push(formatMediaItem(item));
    }

    if (recentItems.length > 0) {
      library['Recently Added'] = recentItems;
    }

    res.json(library);
  } catch (err) {
    console.error('[seedbox] library error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/seedbox/search?q=... ───────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !libraryCache) return res.json({ results: [] });

    const query = q.toLowerCase();
    const results = [];

    for (const [id, item] of mediaIndex) {
      const title = (item.showTitle || item.title || '').toLowerCase();
      if (title.includes(query) || (item.filename || '').toLowerCase().includes(query)) {
        results.push(formatMediaItem(item));
      }
    }

    res.json({ results: results.slice(0, 50) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/seedbox/play/:id ───────────────────────────────────────────────
// Analyze a file and return everything needed for playback
router.get('/play/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = mediaIndex.get(id);
    if (!item) return res.status(404).json({ error: 'Media not found' });

    // Run ffprobe on the seedbox (local file — instant)
    const probeData = await ffprobe(item.path);

    // Cache duration + file size on the item (used by stream route for Content-Length)
    if (probeData.format?.duration) item.duration = parseFloat(probeData.format.duration);
    if (probeData.format?.size) item.size = parseInt(probeData.format.size, 10);

    // Determine playback mode
    const playback = analyzePlayback(probeData);

    // Build subtitle list from external files
    const subtitles = (item.subtitles || []).map((sub, idx) => ({
      id: idx,
      language: sub.language,
      code: sub.code,
      title: sub.language,
      codec: sub.codec,
      url: `/api/seedbox/subtitle?path=${encodeURIComponent(sub.path)}`,
      external: true,
    }));

    // Skip embedded subtitle extraction — external .srt files are served directly
    // and embedded extraction via ffmpeg exhausts the SSH connection pool.
    const allSubs = subtitles;

    // Pre-cache external subs only (reads .srt files, no ffmpeg)
    if (allSubs.length > 0) {
      preCacheSubtitles(allSubs, item.path);
    }

    // Stream URL
    const streamUrl = `/api/seedbox/stream?id=${id}&mode=${playback.mode}`;

    // Build title
    let title = item.showTitle || item.title || item.filename;
    let episode = null;
    if (item.mediaType === 'episode' && item.season != null) {
      episode = `S${String(item.season).padStart(2, '0')}`;
      if (item.episode != null) episode += `E${String(item.episode).padStart(2, '0')}`;
    }

    const progress = getProgressForItem(item.id);

    res.json({
      title,
      showTitle: item.showTitle || null,
      episode,
      duration: Math.floor((probeData.format?.duration || 0) * 1000),
      streamUrl,
      playbackMode: playback.mode,
      playbackReason: playback.reason,
      container: probeData.format?.format_name || 'unknown',
      videoCodec: playback.videoCodec,
      audioCodec: playback.audioCodec,
      resolution: playback.resolution,
      bitrate: probeData.format?.bit_rate ? `${Math.round(probeData.format.bit_rate / 1000000)}Mbps` : null,
      subtitles: allSubs,
      thumb: item.tmdbPoster || null,
      backdrop: item.tmdbBackdrop || null,
      rating: item.tmdbRating ?? null,
      overview: item.tmdbOverview || null,
      genres: item.tmdbGenres || null,
      resumeAt: progress?.progress || 0,
    });
  } catch (err) {
    console.error('[seedbox] play error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Subtitle extraction helper (used by endpoint + background pre-cache) ────
async function extractSubtitleVTT(subPath, embedded, codec) {
  let text;

  if (embedded != null) {
    const subIdx = Number(embedded);
    const outFormat = (codec === 'ass' || codec === 'ssa') ? 'ass' : 'srt';
    const cmd = `ffmpeg -hide_banner -loglevel error -i "${shellEscape(subPath)}" -map 0:s:${subIdx} -c:s copy -f ${outFormat} pipe:1`;
    text = await seedbox.exec(cmd, { timeout: 15000 });
  } else {
    text = await seedbox.readFile(subPath);
  }

  if (!text || text.length < 10) return null;

  // Convert to VTT
  if (!text.startsWith('WEBVTT')) {
    if (text.includes('[Script Info]') || text.includes('Dialogue:')) {
      text = assToVtt(text);
    } else {
      text = srtToVtt(text);
    }
  }
  return text;
}

// ── Background pre-cache all subtitles for a media item ─────────────────────
function preCacheSubtitles(allSubs, itemPath) {
  // Fire-and-forget — don't block the play response
  (async () => {
    for (const sub of allSubs) {
      const cacheKey = `seedbox:${sub.url}`;
      const cached = db.prepare('SELECT 1 FROM subtitle_cache WHERE key = ?').get(cacheKey);
      if (cached) continue; // already cached

      try {
        // Parse the sub.url query string to get extraction params
        const url = new URL(sub.url, 'http://localhost');
        const subPath = url.searchParams.get('path');
        const embedded = url.searchParams.get('embedded');
        const codec = url.searchParams.get('codec');

        const vtt = await extractSubtitleVTT(subPath, embedded, codec);
        if (vtt) {
          db.prepare('INSERT OR REPLACE INTO subtitle_cache (key, vtt) VALUES (?, ?)').run(cacheKey, vtt);
          console.log(`[seedbox] Cached subtitle: ${sub.title} (${vtt.length} bytes)`);
        }
      } catch (err) {
        console.warn(`[seedbox] Pre-cache subtitle failed for ${sub.title}:`, err.message);
      }
    }
  })();
}

// ── GET /api/seedbox/subtitle ───────────────────────────────────────────────
// Serve a subtitle file as VTT — checks DB cache first
router.get('/subtitle', async (req, res) => {
  try {
    const { path: subPath, embedded, codec } = req.query;
    if (!subPath) return res.status(400).json({ error: 'path required' });

    // Cache key matches the sub.url from play endpoint (e.g. /api/seedbox/subtitle?path=...&embedded=0&codec=srt)
    const cacheKey = `seedbox:${req.originalUrl}`;

    // Check DB cache first
    const cached = db.prepare('SELECT vtt FROM subtitle_cache WHERE key = ?').get(cacheKey);
    if (cached) {
      console.log(`[seedbox] Subtitle cache hit: ${cacheKey.slice(0, 60)}...`);
      res.set('Content-Type', 'text/vtt; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Subtitle-Cache', 'hit');
      return res.send(cached.vtt);
    }

    // Extract from seedbox
    const text = await extractSubtitleVTT(subPath, embedded, codec);
    if (!text) {
      return res.status(404).json({ error: 'Subtitle empty or not found' });
    }

    // Store in DB cache for next time
    db.prepare('INSERT OR REPLACE INTO subtitle_cache (key, vtt) VALUES (?, ?)').run(cacheKey, text);
    console.log(`[seedbox] Subtitle cached: ${text.length} bytes`);

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Subtitle-Cache', 'miss');
    res.send(text);
  } catch (err) {
    console.error('[seedbox] subtitle error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/seedbox/stream ─────────────────────────────────────────────────
// Stream video from seedbox via FFmpeg (remux/transcode) or direct proxy
router.get('/stream', async (req, res) => {
  try {
    const { id, mode, start } = req.query;
    const item = mediaIndex.get(Number(id));
    if (!item) return res.status(404).end();

    const filePath = item.path;
    const seekSec = start && Number(start) > 0 ? Number(start) : 0;

    if (mode === 'direct') {
      // Direct stream — pipe the raw file via SFTP with HTTP Range support for seeking.
      // Need the file size to compute ranges; stat the file if we don't have it yet.
      let size = item.size;
      if (!size) {
        try {
          const st = await seedbox.stat(filePath);
          size = st.size;
          item.size = size;
        } catch (e) {
          console.warn('[seedbox] stat failed:', e.message);
        }
      }

      const rangeHeader = req.headers.range;
      let start = 0;
      let end = size ? size - 1 : undefined;
      let partial = false;

      if (rangeHeader && size) {
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          if (match[1]) start = parseInt(match[1], 10);
          if (match[2]) end = parseInt(match[2], 10);
          if (isNaN(start) || start < 0) start = 0;
          if (isNaN(end) || end >= size) end = size - 1;
          if (start > end) {
            res.status(416).set('Content-Range', `bytes */${size}`).end();
            return;
          }
          partial = true;
        }
      }

      const mime = inferMimeType(filePath);
      res.set('Content-Type', mime);
      res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'no-store');

      if (partial) {
        res.status(206);
        res.set('Content-Range', `bytes ${start}-${end}/${size}`);
        res.set('Content-Length', String(end - start + 1));
      } else if (size) {
        res.set('Content-Length', String(size));
      }

      try {
        const stream = await seedbox.readStream(filePath, { start, end });
        stream.on('error', (e) => {
          console.warn('[seedbox] direct stream error:', e.message);
          if (!res.writableEnded) res.end();
        });
        stream.pipe(res);
        req.on('close', () => { try { stream.destroy(); } catch {} });
      } catch (err) {
        console.error('[seedbox] direct stream open failed:', err.message);
        if (!res.headersSent) res.status(502).end();
      }
      return;
    }

    // Remux or remux-audio: FFmpeg on the seedbox, pipe fMP4 over SSH
    const args = ['ffmpeg', '-hide_banner', '-loglevel', 'warning'];

    if (seekSec > 0 && mode === 'remux') {
      args.push('-ss', String(seekSec));
    }

    args.push('-i', `"${shellEscape(filePath)}"`);

    if (seekSec > 0 && (mode === 'remux-audio' || mode === 'transcode')) {
      args.push('-ss', String(seekSec));
    }

    // Video
    if (mode === 'transcode') {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22');
    } else {
      args.push('-c:v', 'copy');
    }

    // Audio
    if (mode === 'remux-audio' || mode === 'transcode') {
      args.push('-c:a', 'aac', '-b:a', '320k', '-ac', '2', '-async', '1');
    } else {
      args.push('-c:a', 'copy');
    }

    args.push(
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-sn',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    );

    const cmd = args.join(' ');
    console.log(`[seedbox] Stream ${mode}: ${item.filename}${seekSec > 0 ? ` @${seekSec}s` : ''}`);

    const { stream } = await seedbox.execStream(cmd);

    res.set('Content-Type', 'video/mp4');
    res.set('Cache-Control', 'no-store');
    res.set('X-Accel-Buffering', 'no'); // Disable proxy buffering (nginx, Vite)

    // Send Content-Length so Chrome's <video> element accepts the stream.
    // For remux (copy codecs), output ≈ input size. For seek, estimate remaining.
    // This lets us skip MediaSource API entirely — Chrome handles it natively.
    if (item.size) {
      if (seekSec > 0) {
        const duration = item.duration || 1;
        const fraction = Math.max(0, 1 - seekSec / duration);
        res.set('Content-Length', String(Math.floor(item.size * fraction)));
      } else {
        res.set('Content-Length', String(item.size));
      }
    }

    stream.pipe(res);

    stream.stderr?.on('data', (d) => {
      // Log FFmpeg warnings/errors
      const msg = d.toString().trim();
      if (msg) console.log(`[seedbox] FFmpeg: ${msg.slice(0, 200)}`);
    });

    stream.on('close', () => {
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => {
      stream.close();
    });
  } catch (err) {
    console.error('[seedbox] stream error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

// ── FFprobe ─────────────────────────────────────────────────────────────────

/**
 * Run ffprobe on a file on the seedbox and return parsed JSON.
 */
async function ffprobe(filePath) {
  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${shellEscape(filePath)}"`;
  const output = await seedbox.exec(cmd, { timeout: 15000 });
  return JSON.parse(output);
}

// ── Playback Analysis ───────────────────────────────────────────────────────

const BROWSER_VIDEO = new Set(['h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis', 'ac3', 'eac3']);
const BROWSER_CONTAINERS = new Set(['mp4', 'mov', 'webm']);
const REMUX_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis', 'ac3', 'eac3']);

function analyzePlayback(probeData) {
  const videoStream = (probeData.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (probeData.streams || []).find((s) => s.codec_type === 'audio');

  const container = (probeData.format?.format_name || '').split(',')[0].toLowerCase();
  const videoCodec = (videoStream?.codec_name || '').toLowerCase();
  const audioCodec = (audioStream?.codec_name || '').toLowerCase();
  const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : null;

  const info = { container, videoCodec, audioCodec, resolution };

  // Direct play — browser-native container + codecs
  if (BROWSER_CONTAINERS.has(container) && BROWSER_VIDEO.has(videoCodec) && BROWSER_AUDIO.has(audioCodec)) {
    return { ...info, mode: 'direct', reason: 'Browser-compatible — playing original' };
  }

  // Remux only — container change (e.g. MKV→MP4), codecs preserved, no quality loss
  if (BROWSER_VIDEO.has(videoCodec) && REMUX_SAFE_AUDIO.has(audioCodec)) {
    return { ...info, mode: 'remux', reason: `Remuxing ${container.toUpperCase()}→MP4 — original quality` };
  }

  // Remux + audio transcode — video copy, audio to AAC
  if (BROWSER_VIDEO.has(videoCodec)) {
    return { ...info, mode: 'remux-audio', reason: `Original video, ${audioCodec.toUpperCase()}→AAC audio` };
  }

  // Full transcode — unsupported video codec
  return { ...info, mode: 'transcode', reason: `${videoCodec.toUpperCase()} needs full transcode` };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a media item for the frontend (matches Plex item shape for MediaCard compatibility).
 */
function formatMediaItem(item) {
  const progress = getProgressForItem(item.id);
  return {
    id: item.id,
    title: item.tmdbTitle || item.showTitle || item.title || item.filename,
    year: item.tmdbYear || item.year || null,
    rating: item.tmdbRating ?? null,
    type: item.mediaType === 'episode' ? 'show' : (item.mediaType || 'movie'),
    genre: item.tmdbGenres || '',
    thumb: item.tmdbPoster || null,
    backdrop: item.tmdbBackdrop || null,
    progress: progress?.progress ?? 0,
    duration: progress?.duration ?? item.duration ?? null,
    episode: item.mediaType === 'episode' && item.season != null
      ? `S${String(item.season).padStart(2, '0')}${item.episode != null ? `E${String(item.episode).padStart(2, '0')}` : ''}`
      : null,
    description: item.tmdbOverview || '',
    backend: 'seedbox',
    // Extra fields for playback
    quality: item.quality,
    source: item.source,
    codec: item.codec,
    audio: item.audio,
    group: item.group,
    size: item.size,
    filename: item.filename,
  };
}

/**
 * Fetch watch progress for a single seedbox item from the watch_history table.
 * Items are keyed by `seedbox:<id>` in watch_history.
 */
function getProgressForItem(id) {
  try {
    return db.prepare(
      "SELECT progress, duration FROM watch_history WHERE item_id = ? AND type IN ('vod','series')"
    ).get(`seedbox:${id}`);
  } catch { return null; }
}

/**
 * Background TMDB enrichment — fetches metadata for each unique title
 * and attaches it to items in the mediaIndex. Skips items that already
 * have a manual override or fresh enrichment data.
 */
async function enrichWithTMDB(library) {
  if (!library) return;
  let enriched = 0;

  // Enrich movies — one lookup per movie (dedupe by title+year)
  const movieKeys = new Set();
  for (const movie of library.movies) {
    const key = `${movie.title}|${movie.year || ''}`;
    if (movieKeys.has(key)) continue;
    movieKeys.add(key);
    if (movie.tmdbId) continue; // already has a match

    const meta = await tmdb.lookupMovie(movie.title, movie.year);
    if (!meta) continue;
    for (const m of library.movies) {
      if (m.tmdbId) continue;
      if (m.title === movie.title && m.year === movie.year) {
        applyTmdb(m, meta);
        enriched++;
      }
    }
  }

  // Enrich shows — one lookup per show title
  for (const [showTitle, show] of Object.entries(library.shows)) {
    // Check if any episode of this show already has a match
    const firstEp = Object.values(show.seasons)[0]?.[0];
    if (firstEp?.tmdbId) continue;

    const meta = await tmdb.lookupShow(showTitle);
    if (!meta) continue;
    for (const season of Object.values(show.seasons)) {
      for (const ep of season) {
        if (ep.tmdbId) continue;
        applyTmdb(ep, meta);
        enriched++;
      }
    }
  }

  if (enriched > 0) console.log(`[seedbox] TMDB enriched ${enriched} items`);
}

/**
 * Apply all manual TMDB overrides to items in the current mediaIndex.
 * Called after each scan so user-chosen matches survive rescans.
 */
async function applyManualOverrides() {
  const overrides = db.prepare('SELECT item_id, tmdb_id, type FROM seedbox_matches').all();
  if (!overrides.length) return;

  let applied = 0;
  for (const ov of overrides) {
    const targets = findMatchTargets(ov.item_id);
    if (!targets.length) continue;
    const meta = await tmdb.lookupById(ov.tmdb_id, ov.type);
    if (!meta) continue;
    for (const t of targets) {
      applyTmdb(t, meta);
      applied++;
    }
  }
  if (applied > 0) console.log(`[seedbox] Applied ${applied} manual matches from ${overrides.length} overrides`);
}

/**
 * Given an item id, return all mediaIndex items that should share the same
 * TMDB match. For movies that's just the item itself. For shows, it's every
 * episode of the same show (so matching S01E01 applies to all episodes).
 */
function findMatchTargets(itemId) {
  const item = mediaIndex.get(itemId);
  if (!item) return [];
  if (item.showTitle) {
    const targets = [];
    for (const other of mediaIndex.values()) {
      if (other.showTitle === item.showTitle) targets.push(other);
    }
    return targets;
  }
  return [item];
}

function applyTmdb(item, meta) {
  item.tmdbId = meta.tmdbId;
  item.tmdbTitle = meta.title;
  item.tmdbYear = meta.year;
  item.tmdbPoster = meta.poster;
  item.tmdbBackdrop = meta.backdrop;
  item.tmdbRating = meta.rating;
  item.tmdbGenres = meta.genres;
  item.tmdbOverview = meta.overview;
}

function shellEscape(str) {
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

function inferMimeType(path) {
  const ext = (path.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  switch (ext) {
    case 'mp4': case 'm4v': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case 'avi': return 'video/x-msvideo';
    case 'ts': return 'video/mp2t';
    default: return 'video/mp4';
  }
}

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

const LANG_NAMES = {
  eng: 'English', en: 'English',
  dan: 'Dansk', da: 'Dansk',
  swe: 'Svenska', sv: 'Svenska',
  nor: 'Norsk', no: 'Norsk', nob: 'Norsk',
  fin: 'Suomi', fi: 'Suomi',
  ger: 'Deutsch', de: 'Deutsch', deu: 'Deutsch',
  fre: 'Français', fr: 'Français', fra: 'Français',
  spa: 'Español', es: 'Español',
  ita: 'Italiano', it: 'Italiano',
  por: 'Português', pt: 'Português',
  dut: 'Nederlands', nl: 'Nederlands', nld: 'Nederlands',
  pol: 'Polski', pl: 'Polski',
  rus: 'Русский', ru: 'Русский',
  ara: 'العربية', ar: 'العربية',
  chi: '中文', zh: '中文', zho: '中文',
  jpn: '日本語', ja: '日本語',
  kor: '한국어', ko: '한국어',
  und: 'Unknown',
};

// ── Auto-scan interval ──────────────────────────────────────────────────────
let autoScanInterval = null;

/**
 * Start auto-scanning the media folder at a regular interval.
 * @param {number} intervalMs - Scan interval in milliseconds (default: 10 minutes)
 */
export function startAutoScan(intervalMs = 10 * 60 * 1000) {
  if (autoScanInterval) clearInterval(autoScanInterval);

  // Initial scan on startup
  if (seedbox.isConnected()) {
    refreshLibrary().catch((e) => console.error('[seedbox] Initial scan failed:', e.message));
  }

  autoScanInterval = setInterval(async () => {
    if (!seedbox.isConnected()) return;
    try {
      await refreshLibrary();
    } catch (e) {
      console.error('[seedbox] Auto-scan failed:', e.message);
    }
  }, intervalMs);

  console.log(`[seedbox] Auto-scan enabled: every ${Math.round(intervalMs / 60000)} minutes`);
}

export function stopAutoScan() {
  if (autoScanInterval) {
    clearInterval(autoScanInterval);
    autoScanInterval = null;
  }
}

export function getMediaIndex() { return mediaIndex; }
export function getLibraryCache() { return libraryCache; }
export { refreshLibrary };
export default router;
