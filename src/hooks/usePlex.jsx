import { useState, useEffect, useCallback } from 'react';
import { useConfig } from './useConfig';

export function usePlexLibrary() {
  const { config } = useConfig();
  const [library, setLibrary] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLibrary = useCallback(async () => {
    const { serverUrl, token } = config.plex;
    if (!serverUrl || !token) {
      setConnected(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/plex/library`);
      if (!res.ok) throw new Error(`Plex API returned ${res.status}`);
      const data = await res.json();
      setLibrary(data);
      setConnected(true);
    } catch (err) {
      setError(err.message);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [config.plex]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  return { library, connected, loading, error, refetch: fetchLibrary };
}

export function usePlexSearch(query) {
  const { config } = useConfig();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2 || !config.plex.serverUrl) {
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
