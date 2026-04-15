/**
 * Media Scanner
 *
 * Scans the seedbox filesystem, identifies media files, parses filenames
 * to extract title/year/season/episode, and discovers subtitle files.
 *
 * Optimizations:
 * - Incremental scanning: only re-scans folders whose mtime changed
 * - Parallel directory listing: processes up to 5 dirs concurrently
 * - Cached results persist between scans for unchanged folders
 *
 * Filename parsing handles standard scene/P2P naming conventions:
 *   Movie.Name.2024.1080p.BluRay.x264-GROUP.mkv
 *   Show.Name.S01E05.NORDiC.1080p.WEB-DL.H.264.DD5.1-GROUP.mkv
 */

import seedbox from './seedbox.js';

// Video file extensions we care about
const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv']);
const SUB_EXTS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

// ── Incremental Scan Cache ─────────────────────────────────────────────────
// Maps directory name → { mtime, items: [...parsed media items] }
const dirCache = new Map();

// ── Filename Parsing ────────────────────────────────────────────────────────

/**
 * Parse a scene/P2P media filename into structured data.
 * @param {string} filename - e.g. "Community.S01E01.NORDiC.1080p.WEB-DL.H.264.DD5.1-TWASERiES.mkv"
 * @returns {{ title, year?, season?, episode?, quality?, source?, codec?, audio?, group? }}
 */
export function parseFilename(filename) {
  // Remove extension
  const noExt = filename.replace(/\.[^.]+$/, '');

  // Try TV show pattern: S01E01, S01E01E02, or S01 (full season pack)
  const tvMatch = noExt.match(
    /^(.+?)[.\s_-]+S(\d{1,2})(?:E(\d{1,3})(?:E\d{1,3})*)?[.\s_-]*(.*)/i
  );

  if (tvMatch) {
    const rawTitle = tvMatch[1];
    const season = parseInt(tvMatch[2], 10);
    const episode = tvMatch[3] ? parseInt(tvMatch[3], 10) : null;
    const rest = tvMatch[4] || '';

    return {
      type: 'show',
      title: cleanTitle(rawTitle),
      season,
      episode,
      ...parseTags(rest),
    };
  }

  // Try movie pattern: Name.Year.Tags
  const movieMatch = noExt.match(/^(.+?)[.\s_-]+((?:19|20)\d{2})[.\s_-]*(.*)/);
  if (movieMatch) {
    return {
      type: 'movie',
      title: cleanTitle(movieMatch[1]),
      year: parseInt(movieMatch[2], 10),
      ...parseTags(movieMatch[3] || ''),
    };
  }

  // Fallback — just clean the filename as title
  return {
    type: 'unknown',
    title: cleanTitle(noExt),
    ...parseTags(noExt),
  };
}

/**
 * Replace dots/underscores with spaces and clean up.
 */
function cleanTitle(raw) {
  return raw
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ - $/, '')
    .trim();
}

/**
 * Extract quality/source/codec/audio/group from the tag portion of a filename.
 */
function parseTags(tagStr) {
  const tags = {};
  const lower = tagStr.toLowerCase();

  // Quality
  if (/2160p|4k|uhd/i.test(lower)) tags.quality = '4K';
  else if (/1080p/i.test(lower)) tags.quality = '1080p';
  else if (/720p/i.test(lower)) tags.quality = '720p';
  else if (/480p/i.test(lower)) tags.quality = '480p';

  // Source
  if (/blu-?ray|bdrip|bdremux/i.test(lower)) tags.source = 'BluRay';
  else if (/web-?dl/i.test(lower)) tags.source = 'WEB-DL';
  else if (/webrip/i.test(lower)) tags.source = 'WEBRip';
  else if (/hdtv/i.test(lower)) tags.source = 'HDTV';
  else if (/dvdrip/i.test(lower)) tags.source = 'DVDRip';

  // Video codec
  if (/[hx]\.?265|hevc/i.test(lower)) tags.codec = 'HEVC';
  else if (/[hx]\.?264|avc/i.test(lower)) tags.codec = 'H.264';
  else if (/av1/i.test(lower)) tags.codec = 'AV1';
  else if (/vp9/i.test(lower)) tags.codec = 'VP9';

  // Audio
  if (/atmos/i.test(lower)) tags.audio = 'Atmos';
  else if (/truehd/i.test(lower)) tags.audio = 'TrueHD';
  else if (/dts-?hd/i.test(lower)) tags.audio = 'DTS-HD';
  else if (/dts/i.test(lower)) tags.audio = 'DTS';
  else if (/ddp?\d|dd\d|dolby\s*digital/i.test(lower)) tags.audio = 'DD5.1';
  else if (/eac3|e-ac-?3/i.test(lower)) tags.audio = 'EAC3';
  else if (/aac/i.test(lower)) tags.audio = 'AAC';

  // Release group (after last hyphen)
  const groupMatch = tagStr.match(/-([A-Za-z0-9]+)$/);
  if (groupMatch) tags.group = groupMatch[1];

  return tags;
}

// ── Subtitle Discovery ──────────────────────────────────────────────────────

// Common language codes in subtitle filenames
const LANG_MAP = {
  en: 'English', eng: 'English', english: 'English',
  da: 'Dansk', dan: 'Dansk', danish: 'Dansk',
  sv: 'Svenska', swe: 'Svenska', swedish: 'Svenska',
  no: 'Norsk', nor: 'Norsk', norwegian: 'Norsk', nb: 'Norsk',
  fi: 'Suomi', fin: 'Suomi', finnish: 'Suomi',
  de: 'Deutsch', ger: 'Deutsch', deu: 'Deutsch', german: 'Deutsch',
  fr: 'Français', fre: 'Français', fra: 'Français', french: 'Français',
  es: 'Español', spa: 'Español', spanish: 'Español',
  it: 'Italiano', ita: 'Italiano', italian: 'Italiano',
  pt: 'Português', por: 'Português', portuguese: 'Português',
  nl: 'Nederlands', dut: 'Nederlands', nld: 'Nederlands',
  pl: 'Polski', pol: 'Polski',
  ru: 'Русский', rus: 'Русский',
  ar: 'العربية', ara: 'العربية',
  zh: '中文', chi: '中文', zho: '中文',
  ja: '日本語', jpn: '日本語',
  ko: '한국어', kor: '한국어',
};

/**
 * Find external subtitle files for a given video file.
 * Looks for files like: VideoName.da.srt, VideoName.en.srt, etc.
 * @param {string} videoPath - Full path to the video file on seedbox
 * @param {Array} dirContents - Already-listed directory contents (to avoid re-listing)
 * @returns {Array<{path, language, code, codec}>}
 */
export function findExternalSubs(videoPath, dirContents) {
  const videoBase = videoPath.replace(/\.[^.]+$/, ''); // Remove extension
  const videoName = videoBase.split('/').pop();         // Just filename without ext

  const subs = [];
  for (const item of dirContents) {
    if (item.type !== 'file') continue;
    const ext = getExt(item.name);
    if (!SUB_EXTS.has(ext)) continue;

    // Check if this subtitle belongs to this video
    // Pattern: VideoName.lang.srt or VideoName.srt
    if (!item.name.startsWith(videoName)) continue;

    const subBase = item.name.replace(/\.[^.]+$/, ''); // Remove .srt
    const langPart = subBase.slice(videoName.length + 1).toLowerCase(); // e.g. "da", "en", "sdh.en"

    // Extract language code
    let language = 'Unknown';
    let code = '';

    if (langPart) {
      // Handle compound tags: "sdh.en", "forced.en", "en.sdh"
      const parts = langPart.split('.');
      for (const part of parts) {
        if (LANG_MAP[part]) {
          language = LANG_MAP[part];
          code = part.length <= 3 ? part : part.slice(0, 2);
          break;
        }
      }
      // Check for SDH/Forced tags
      const tags = [];
      if (parts.includes('sdh') || parts.includes('hi')) tags.push('SDH');
      if (parts.includes('forced')) tags.push('Forced');
      if (tags.length && language !== 'Unknown') {
        language = `${language} (${tags.join(', ')})`;
      }
    }

    const codec = ext === '.ass' || ext === '.ssa' ? 'ass' : 'srt';
    subs.push({
      path: `${videoBase.substring(0, videoBase.lastIndexOf('/') + 1)}${item.name}`,
      language,
      code,
      codec,
      filename: item.name,
    });
  }

  return subs;
}

// ── Parallel Directory Processing ──────────────────────────────────────────

/**
 * Process an array of items with limited concurrency.
 * @param {Array} items
 * @param {number} concurrency - Max parallel promises
 * @param {Function} fn - Async function to call for each item
 */
async function parallelMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Full Library Scan ───────────────────────────────────────────────────────

const PARALLEL_DIRS = 5; // How many directories to list simultaneously

/**
 * Scan the seedbox media directory and return a structured library.
 * Uses incremental scanning — only rescans directories whose mtime changed.
 * @param {boolean} force - If true, ignore cache and rescan everything
 * @returns {Promise<{movies: Array, shows: Object, stats: Object}>}
 */
export async function scanLibrary(force = false) {
  const mediaPath = seedbox.getMediaPath();
  const topLevel = await seedbox.listDir(mediaPath);

  const movies = [];
  const shows = {};  // { "Show Title": { seasons: { 1: [episodes], 2: [...] } } }
  let scannedDirs = 0;
  let cachedDirs = 0;

  // Separate files and directories
  const topFiles = topLevel.filter((e) => e.type === 'file' && isVideoFile(e.name));
  const topDirs = topLevel.filter((e) => e.type === 'directory');

  // Process top-level files (usually movies)
  for (const entry of topFiles) {
    const fullPath = `${mediaPath}/${entry.name}`;
    const parsed = parseFilename(entry.name);
    if (parsed.type === 'show') {
      addEpisode(shows, parsed, fullPath, entry, []);
    } else {
      movies.push({
        ...parsed,
        path: fullPath,
        filename: entry.name,
        size: entry.size,
        mtime: entry.mtime,
        subtitles: [],
      });
    }
  }

  // Detect removed folders — clean cache
  const currentDirNames = new Set(topDirs.map((d) => d.name));
  for (const key of dirCache.keys()) {
    if (!currentDirNames.has(key)) dirCache.delete(key);
  }

  // Process directories in parallel, with incremental caching
  await parallelMap(topDirs, PARALLEL_DIRS, async (entry) => {
    const fullPath = `${mediaPath}/${entry.name}`;
    const cacheKey = entry.name;
    const cached = dirCache.get(cacheKey);

    // Skip if mtime hasn't changed (incremental scan)
    if (!force && cached && cached.mtime >= entry.mtime.getTime()) {
      // Replay cached results into movies/shows
      for (const item of cached.items) {
        if (item._isEpisode) {
          addEpisode(shows, item._parsed, item.path, item._fileEntry, item.subtitles);
        } else {
          movies.push(item);
        }
      }
      cachedDirs++;
      return;
    }

    // Need to scan this directory
    scannedDirs++;
    const dirItems = [];

    try {
      const dirContents = await seedbox.listDir(fullPath);
      const parsed = parseFilename(entry.name);
      const videoFiles = dirContents.filter((f) => f.type === 'file' && isVideoFile(f.name));
      const allFiles = dirContents.filter((f) => f.type === 'file');

      if (videoFiles.length === 0) return;

      if (parsed.type === 'show' && parsed.season != null) {
        // Season pack directory
        for (const vf of videoFiles) {
          const epParsed = parseFilename(vf.name);
          const epPath = `${fullPath}/${vf.name}`;
          const externalSubs = findExternalSubs(epPath, allFiles);
          const merged = { ...parsed, ...epParsed };
          addEpisode(shows, merged, epPath, vf, externalSubs);
          dirItems.push({
            _isEpisode: true,
            _parsed: merged,
            _fileEntry: { name: vf.name, size: vf.size, mtime: vf.mtime },
            path: epPath,
            subtitles: externalSubs,
          });
        }
      } else if (videoFiles.length === 1) {
        const vf = videoFiles[0];
        const vfParsed = parseFilename(vf.name);
        const vfPath = `${fullPath}/${vf.name}`;
        const externalSubs = findExternalSubs(vfPath, allFiles);

        if (vfParsed.type === 'show') {
          addEpisode(shows, vfParsed, vfPath, vf, externalSubs);
          dirItems.push({
            _isEpisode: true,
            _parsed: vfParsed,
            _fileEntry: { name: vf.name, size: vf.size, mtime: vf.mtime },
            path: vfPath,
            subtitles: externalSubs,
          });
        } else {
          const item = {
            ...parsed,
            ...vfParsed,
            path: vfPath,
            filename: vf.name,
            size: vf.size,
            mtime: vf.mtime,
            subtitles: externalSubs,
          };
          movies.push(item);
          dirItems.push(item);
        }
      } else {
        // Multiple videos — season pack or multi-episode
        for (const vf of videoFiles) {
          const epParsed = parseFilename(vf.name);
          const epPath = `${fullPath}/${vf.name}`;
          const externalSubs = findExternalSubs(epPath, allFiles);

          if (epParsed.type === 'show') {
            addEpisode(shows, epParsed, epPath, vf, externalSubs);
            dirItems.push({
              _isEpisode: true,
              _parsed: epParsed,
              _fileEntry: { name: vf.name, size: vf.size, mtime: vf.mtime },
              path: epPath,
              subtitles: externalSubs,
            });
          } else {
            const item = {
              ...epParsed,
              path: epPath,
              filename: vf.name,
              size: vf.size,
              mtime: vf.mtime,
              subtitles: externalSubs,
            };
            movies.push(item);
            dirItems.push(item);
          }
        }
      }
    } catch (err) {
      console.error(`[scanner] Error scanning ${entry.name}: ${err.message}`);
      return;
    }

    // Cache this directory's results
    dirCache.set(cacheKey, {
      mtime: entry.mtime.getTime(),
      items: dirItems,
    });
  });

  return {
    movies,
    shows,
    stats: {
      totalDirs: topDirs.length,
      scannedDirs,
      cachedDirs,
      totalFiles: topFiles.length,
    },
  };
}

/**
 * Add an episode to the shows structure.
 */
function addEpisode(shows, parsed, filePath, fileEntry, externalSubs) {
  const showTitle = parsed.title || 'Unknown Show';
  if (!shows[showTitle]) {
    shows[showTitle] = {
      title: showTitle,
      quality: parsed.quality,
      source: parsed.source,
      codec: parsed.codec,
      audio: parsed.audio,
      group: parsed.group,
      seasons: {},
    };
  }

  const season = parsed.season || 1;
  if (!shows[showTitle].seasons[season]) {
    shows[showTitle].seasons[season] = [];
  }

  shows[showTitle].seasons[season].push({
    episode: parsed.episode,
    season,
    title: parsed.title,
    quality: parsed.quality || shows[showTitle].quality,
    source: parsed.source || shows[showTitle].source,
    codec: parsed.codec || shows[showTitle].codec,
    audio: parsed.audio || shows[showTitle].audio,
    group: parsed.group || shows[showTitle].group,
    path: filePath,
    filename: fileEntry.name,
    size: fileEntry.size,
    mtime: fileEntry.mtime,
    subtitles: externalSubs,
  });

  // Sort episodes within season
  shows[showTitle].seasons[season].sort((a, b) => (a.episode || 0) - (b.episode || 0));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getExt(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function isVideoFile(filename) {
  return VIDEO_EXTS.has(getExt(filename));
}

export default {
  parseFilename,
  findExternalSubs,
  scanLibrary,
};
