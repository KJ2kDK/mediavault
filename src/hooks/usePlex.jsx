import { useState, useEffect, useCallback } from 'react';
import { useConfig } from './useConfig';

const PLEX_CACHE_KEY = 'mediavault_plex_library';

function getPlexCache() {
  try {
    const raw = sessionStorage.getItem(PLEX_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setPlexCache(data) {
  try { sessionStorage.setItem(PLEX_CACHE_KEY, JSON.stringify(data)); } catch {}
}

export function usePlexLibrary() {
  const { config } = useConfig();
  // Initialize from cache so the page renders instantly with previous data
  const cached = getPlexCache();
  const [library, setLibrary] = useState(cached);
  const [connected, setConnected] = useState(!!cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/plex/library`);
      if (!res.ok) throw new Error(`Plex API returned ${res.status}`);
      const data = await res.json();
      setLibrary(data);
      setConnected(true);
      setPlexCache(data);
    } catch (err) {
      setError(err.message);
      // Only disconnect if we have no cached data
      if (!library) setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [config.plex]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Full refresh: trigger Plex library scan, wait for results, update cache
  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plex/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`Plex refresh returned ${res.status}`);
      const data = await res.json();
      if (data.library) {
        setLibrary(data.library);
        setConnected(true);
        setPlexCache(data.library);
      }
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { library, connected, loading, error, refetch: fetchLibrary, refreshLibrary };
}

export function usePlexSearch(query) {
  const { config } = useConfig();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const search = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/plex/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setResults(data.results || []);
      } catch (err) {
        if (err.name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [query, config.plex.serverUrl]);

  return { results, loading };
}
