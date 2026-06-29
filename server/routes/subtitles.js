import { Router } from 'express';
import { gunzipSync } from 'zlib';
import db from '../db/index.js';
import { dbLog } from './logs.js';
import { resilientFetch as fetch } from '../services/resilient-fetch.js';

// Use the resilient DNS-fallback fetch. node-fetch v3 mangled the host (→ `_`)
// and even global fetch hits intermittent ENOTFOUND for OpenSubtitles because
// libc getaddrinfo is starved under the server's IPTV DNS load. resilientFetch
// falls back to dns.resolve4, mirroring routes/iptv.js.

const router = Router();

// OpenSubtitles.org legacy REST API (free, no key needed)
const OS_API = 'https://rest.opensubtitles.org/search';
const OS_UA = 'MediaVault v1.0';

// Fetch a (possibly gzipped) subtitle and return its decoded text. Global
// fetch exposes the body as bytes via arrayBuffer(), so we gunzip in-memory
// rather than piping a Node stream.
async function fetchSubtitleText(downloadUrl) {
  const subRes = await fetch(downloadUrl, { headers: { 'User-Agent': OS_UA } });
  if (!subRes.ok) throw new Error(`Download failed: ${subRes.status}`);
  const buf = Buffer.from(await subRes.arrayBuffer());
  const contentType = subRes.headers.get('content-type') || '';
  if (contentType.includes('gzip') || downloadUrl.endsWith('.gz')) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

// ── TEMP DIAGNOSTIC — remove after debugging ────────────────────────────────
router.get('/_diag', async (_req, res) => {
  const dnsMod = await import('node:dns');
  const host = 'rest.opensubtitles.org';
  const out = {};
  // 1) default resolve4 (system / 127.0.0.11)
  try { out.defaultResolve4 = await dnsMod.promises.resolve4(host); } catch (e) { out.defaultResolve4 = `ERR ${e.code || e.message}`; }
  // 2) libc lookup
  try { const l = await dnsMod.promises.lookup(host); out.libcLookup = l.address; } catch (e) { out.libcLookup = `ERR ${e.code || e.message}`; }
  // 3) dedicated 1.1.1.1 resolver
  try {
    const r = new dnsMod.Resolver({ timeout: 5000, tries: 2 });
    r.setServers(['1.1.1.1', '8.8.8.8']);
    out.publicResolve4 = await new Promise((ok, no) => r.resolve4(host, (e, a) => e ? no(e) : ok(a)));
  } catch (e) { out.publicResolve4 = `ERR ${e.code || e.message}`; }
  // 4) raw global fetch (undici default dispatcher)
  try { const rr = await globalThis.fetch(`https://${host}/search/query-test/sublanguageid-eng`, { headers: { 'User-Agent': OS_UA } }); out.globalFetch = rr.status; } catch (e) { out.globalFetch = `ERR ${e.message} / ${e.cause?.code || e.cause?.message || ''}`; }
  // 5) resilientFetch (our wrapper)
  try { const rr = await fetch(`https://${host}/search/query-test/sublanguageid-eng`, { headers: { 'User-Agent': OS_UA } }); out.resilientFetch = rr.status; } catch (e) { out.resilientFetch = `ERR ${e.message} / ${e.cause?.code || e.cause?.message || ''}`; }
  res.json(out);
});

// ── GET /api/subtitles/search?query=title&season=1&episode=1&lang=en ─────────
router.get('/search', async (req, res) => {
  try {
    const { query, season, episode, lang = 'en' } = req.query;
    if (!query) return res.status(400).json({ error: 'query required' });

    // Map 2-letter to 3-letter language codes
    const langMap = { en:'eng', da:'dan', sv:'swe', no:'nor', de:'ger', fr:'fre', es:'spa', ja:'jpn', th:'tha', pt:'por', it:'ita', nl:'dut', fi:'fin', ko:'kor', zh:'chi', ar:'ara', ru:'rus' };
    const subLang = langMap[lang] || lang;

    let url = `${OS_API}/query-${encodeURIComponent(query)}/sublanguageid-${subLang}`;
    if (season) url += `/season-${season}`;
    if (episode) url += `/episode-${episode}`;
    console.error('[subtitles/search] DEBUG url=', JSON.stringify(url), '| parsedHost=', (() => { try { return new URL(url).hostname; } catch (e) { return 'PARSE_ERR ' + e.message; } })());
    // In-context A/B: same URL, two fetch impls, inside THIS request handler.
    try { const a = await globalThis.fetch(url, { headers: { 'User-Agent': OS_UA } }); console.error('[subtitles/search] DEBUG globalFetch=', a.status); } catch (e) { console.error('[subtitles/search] DEBUG globalFetch ERR=', e.cause?.code, e.cause?.hostname); }
    try { const b = await fetch(url, { headers: { 'User-Agent': OS_UA } }); console.error('[subtitles/search] DEBUG resilientFetch=', b.status); } catch (e) { console.error('[subtitles/search] DEBUG resilientFetch ERR=', e.cause?.code, e.cause?.hostname); }

    const apiRes = await fetch(url, { headers: { 'User-Agent': OS_UA } });
    if (!apiRes.ok) throw new Error(`OpenSubtitles API: ${apiRes.status}`);
    const data = await apiRes.json();

    const subs = (Array.isArray(data) ? data : []).slice(0, 20).map((s) => ({
      id: s.IDSubtitle,
      fileId: s.IDSubtitleFile,
      language: lang,
      title: s.SubFileName || s.MovieReleaseName || 'Unknown',
      downloads: Number(s.SubDownloadsCnt) || 0,
      hearing_impaired: s.SubHearingImpaired === '1',
      downloadUrl: s.SubDownloadLink,
      format: s.SubFormat || 'srt',
    }));

    res.json({ subtitles: subs, total: subs.length });
  } catch (err) {
    const cause = err.cause?.code || err.cause?.message || '';
    console.error('[subtitles/search] FAIL url=', `${OS_API}/query-${encodeURIComponent(req.query.query)}/sublanguageid-...`,
      '| msg=', err.message, '| cause.code=', err.cause?.code, '| cause.hostname=', err.cause?.hostname, '| cause.msg=', err.cause?.message);
    dbLog('error', 'subtitles/search', err.message, { context: { cause } });
    res.status(500).json({ error: `${err.message}${cause ? ` (${cause})` : ''}` });
  }
});

// ── GET /api/subtitles/download?fileId=123 or &url=downloadUrl ───────────────
router.get('/download', async (req, res) => {
  try {
    const { fileId, url: dlUrl } = req.query;
    const downloadUrl = dlUrl || (fileId ? `https://dl.opensubtitles.org/en/download/src-api/vrf-/filead/${fileId}.gz` : null);
    if (!downloadUrl) return res.status(400).json({ error: 'fileId or url required' });

    let text = await fetchSubtitleText(downloadUrl);

    // Convert SRT to WebVTT
    if (!text.startsWith('WEBVTT')) {
      text = srtToVtt(text);
    }

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/subtitles/translate?fileId=123&from=en&to=da ────────────────────
// Or: ?url=downloadUrl&from=en&to=da
router.get('/translate', async (req, res) => {
  try {
    const { fileId, url: dlUrl, from = 'en', to } = req.query;
    if (!to) return res.status(400).json({ error: 'to language required' });

    const cacheKey = `${fileId || dlUrl}_${from}_${to}`;

    // Check cache
    const cached = db.prepare('SELECT vtt FROM subtitle_cache WHERE key = ?').get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'text/vtt; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(cached.vtt);
    }

    // Download the subtitle
    const downloadUrl = dlUrl || `https://dl.opensubtitles.org/en/download/src-api/vrf-/filead/${fileId}.gz`;
    const text = await fetchSubtitleText(downloadUrl);

    // Parse SRT
    const entries = parseSrt(text);
    console.log(`[subtitles] Parsed ${entries.length} entries, translating ${from}→${to}...`);
    if (!entries.length) throw new Error('No subtitle entries found');

    // Batch translate via MyMemory
    const BATCH = 10;
    const translated = [];
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const joined = batch.map((e) => e.text.replace(/\n/g, ' ')).join('\n');
      try {
        const tRes = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(joined)}&langpair=${from}|${to}`
        );
        const tData = await tRes.json();
        const lines = (tData.responseData?.translatedText || joined).split('\n');
        for (let j = 0; j < batch.length; j++) {
          translated.push({ ...batch[j], text: lines[j] || batch[j].text });
        }
      } catch {
        translated.push(...batch);
      }
    }
    console.log(`[subtitles] Translation complete: ${translated.length} entries`);

    const vtt = buildVtt(translated);
    db.prepare('INSERT OR REPLACE INTO subtitle_cache (key, vtt) VALUES (?, ?)').run(cacheKey, vtt);

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseSrt(srt) {
  const clean = srt.replace(/\r\n/g, '\n').trim();
  const blocks = clean.split(/\n\n+/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) return null;
    const timeMatch = timeLine.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!timeMatch) return null;
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    return {
      start: timeMatch[1].replace(',', '.'),
      end: timeMatch[2].replace(',', '.'),
      text: textLines.join('\n'),
    };
  }).filter(Boolean);
}

function buildVtt(entries) {
  let vtt = 'WEBVTT\n\n';
  for (const e of entries) {
    vtt += `${e.start} --> ${e.end}\n${e.text}\n\n`;
  }
  return vtt;
}

function srtToVtt(srt) {
  let vtt = 'WEBVTT\n\n';
  vtt += srt.replace(/\r\n/g, '\n').replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4').replace(/^\d+\n(?=\d{2}:\d{2}:\d{2})/gm, '');
  return vtt;
}

export default router;
