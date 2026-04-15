import { useState, useEffect, useCallback } from 'react';

const SEEDBOX_CACHE_KEY = 'mediavault_seedbox_library';

function getSeedboxCache() {
  try {
    const raw = sessionStorage.getItem(SEEDBOX_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSeedboxCache(data) {
  try { sessionStorage.setItem(SEEDBOX_CACHE_KEY, JSON.stringify(data)); } catch {}
}

export function useSeedboxLibrary() {
  const cached = getSeedboxCache();
  const [library, setLibrary] = useState(cached);
  const [connected, setConnected] = useState(!!cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/seedbox/library');
      if (!res.ok) throw new Error(`Seedbox API returned ${res.status}`);
      const data = await res.json();

      // Tag all items with backend='seedbox' so the player knows which API to use
      const tagged = {};
      for (const [section, items] of Object.entries(data)) {
        tagged[section] = (items || []).map((item) => ({
          ...item,
          backend: 'seedbox',
        }));
      }

      setLibrary(tagged);
      setConnected(Object.keys(tagged).length > 0);
      setSeedboxCache(tagged);
    } catch (err) {
      setError(err.message);
      if (!library) setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Trigger a rescan
      await fetch('/api/seedbox/scan', { method: 'POST' });
      // Then fetch fresh library
      await fetchLibrary();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchLibrary]);

  return { library, connected, loading, error, refetch: fetchLibrary, refreshLibrary };
}

export function useSeedboxSearch(query) {
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
        const res = await fetch(`/api/seedbox/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        // Tag results with backend
        setResults((data.results || []).map((r) => ({ ...r, backend: 'seedbox' })));
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
  }, [query]);

  return { results, loading };
}
