/**
 * TMDB (The Movie Database) API client with SQLite cache.
 *
 * Gracefully no-ops if TMDB_API_KEY is not set — callers get null back
 * and can fall back to filename-only metadata.
 *
 * Cache TTL: 30 days. Failed lookups are cached as empty rows for 24h
 * so we don't hammer the API for things that don't exist.
 */

import fetch from 'node-fetch';
import db from '../db/index.js';

const API_KEY = process.env.TMDB_API_KEY || '';
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const CACHE_TTL = 30 * 24 * 3600;     // 30 days for hits
const MISS_TTL = 24 * 3600;           // 24h for misses

export function isEnabled() {
  return !!API_KEY;
}

function normalizeKey(type, title, year) {
  const t = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${type}:${t}${year ? ':' + year : ''}`;
}

function readCache(key) {
  const row = db.prepare('SELECT * FROM tmdb_cache WHERE key = ?').get(key);
  if (!row) return null;
  const age = Math.floor(Date.now() / 1000) - row.fetched_at;
  const maxAge = row.tmdb_id ? CACHE_TTL : MISS_TTL;
  if (age > maxAge) return null;
  return row;
}

function writeCache(key, type, data) {
  db.prepare(`
    INSERT OR REPLACE INTO tmdb_cache
      (key, tmdb_id, type, title, year, poster, backdrop, rating, genres, overview, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    key,
    data?.tmdb_id ?? null,
    type,
    data?.title ?? null,
    data?.year ?? null,
    data?.poster ?? null,
    data?.backdrop ?? null,
    data?.rating ?? null,
    data?.genres ?? null,
    data?.overview ?? null,
  );
}

function rowToResult(row) {
  if (!row || !row.tmdb_id) return null;
  return {
    tmdbId: row.tmdb_id,
    type: row.type,
    title: row.title,
    year: row.year,
    poster: row.poster,
    backdrop: row.backdrop,
    rating: row.rating,
    genres: row.genres,
    overview: row.overview,
  };
}

async function tmdbFetch(path, params = {}) {
  const q = new URLSearchParams({ api_key: API_KEY, ...params });
  const res = await fetch(`${API}${path}?${q}`, { timeout: 8000 });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

/**
 * Look up a movie by title (and optional year). Returns enrichment data or null.
 */
export async function lookupMovie(title, year = null) {
  if (!API_KEY || !title) return null;
  const key = normalizeKey('movie', title, year);
  const cached = readCache(key);
  if (cached) return rowToResult(cached);

  try {
    const data = await tmdbFetch('/search/movie', {
      query: title,
      ...(year ? { year: String(year) } : {}),
    });
    const hit = data.results?.[0];
    if (!hit) {
      writeCache(key, 'movie', null);
      return null;
    }

    // Fetch full details for genres/runtime
    let genres = '';
    try {
      const full = await tmdbFetch(`/movie/${hit.id}`);
      genres = (full.genres || []).map((g) => g.name).join(', ');
    } catch {}

    const result = {
      tmdb_id: hit.id,
      title: hit.title,
      year: hit.release_date ? parseInt(hit.release_date.slice(0, 4), 10) : null,
      poster: hit.poster_path ? `${IMG}/w500${hit.poster_path}` : null,
      backdrop: hit.backdrop_path ? `${IMG}/w1280${hit.backdrop_path}` : null,
      rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : null,
      genres,
      overview: hit.overview || null,
    };
    writeCache(key, 'movie', result);
    return rowToResult({ ...result, type: 'movie' });
  } catch (err) {
    console.warn(`[tmdb] movie lookup failed for "${title}" (${year}):`, err.message);
    return null;
  }
}

/**
 * Look up a TV show by title. Returns enrichment data or null.
 */
export async function lookupShow(title) {
  if (!API_KEY || !title) return null;
  const key = normalizeKey('tv', title);
  const cached = readCache(key);
  if (cached) return rowToResult(cached);

  try {
    const data = await tmdbFetch('/search/tv', { query: title });
    const hit = data.results?.[0];
    if (!hit) {
      writeCache(key, 'tv', null);
      return null;
    }

    let genres = '';
    try {
      const full = await tmdbFetch(`/tv/${hit.id}`);
      genres = (full.genres || []).map((g) => g.name).join(', ');
    } catch {}

    const result = {
      tmdb_id: hit.id,
      title: hit.name,
      year: hit.first_air_date ? parseInt(hit.first_air_date.slice(0, 4), 10) : null,
      poster: hit.poster_path ? `${IMG}/w500${hit.poster_path}` : null,
      backdrop: hit.backdrop_path ? `${IMG}/w1280${hit.backdrop_path}` : null,
      rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : null,
      genres,
      overview: hit.overview || null,
    };
    writeCache(key, 'tv', result);
    return rowToResult({ ...result, type: 'tv' });
  } catch (err) {
    console.warn(`[tmdb] show lookup failed for "${title}":`, err.message);
    return null;
  }
}

export default { isEnabled, lookupMovie, lookupShow };
