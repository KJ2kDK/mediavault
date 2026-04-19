import { useState, useEffect, useCallback, useMemo } from 'react';

// Shared cache so all hook instances for the same type stay in sync
const cache = {};
const listeners = {};

function notify(type) {
  (listeners[type] ?? []).forEach((fn) => fn());
}

export function useBookmarks(type) {
  const [bookmarks, setBookmarks] = useState(() => cache[type] ?? []);
  const [loading, setLoading] = useState(!cache[type]);

  // Register listener so sibling hook instances update together
  useEffect(() => {
    if (!listeners[type]) listeners[type] = [];
    const refresh = () => setBookmarks([...(cache[type] ?? [])]);
    listeners[type].push(refresh);
    return () => {
      listeners[type] = listeners[type].filter((fn) => fn !== refresh);
    };
  }, [type]);

  // Initial fetch + one-time localStorage migration
  useEffect(() => {
    if (cache[type]) return;
    setLoading(true);

    fetch(`/api/library/bookmarks?type=${type}`)
      .then((r) => r.json())
      .then(async (data) => {
        const dbRows = data.bookmarks ?? [];

        // If DB is empty for this type, check localStorage for old bookmarks to migrate
        if (dbRows.length === 0) {
          try {
            const saved = JSON.parse(localStorage.getItem('mediavault_config') || '{}');
            const oldKey = type === 'channel' ? 'bookmarks' : 'vodBookmarks';
            const old = saved.iptv?.[oldKey] ?? [];
            if (old.length > 0) {
              await Promise.all(old.map((item) =>
                fetch('/api/library/bookmarks', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: item.id, type,
                    title: item.title ?? item.name ?? 'Unknown',
                    logo: item.logo ?? null,
                    thumb: item.thumb ?? null,
                    group_name: item.group ?? item.group_name ?? null,
                    category_id: item.category_id ?? null,
                    url: item.url ?? null,
                    year: item.year ?? null,
                    rating: item.rating ?? null,
                    source: item.backend === 'seedbox' ? 'seedbox' : 'iptv',
                  }),
                })
              ));
              // Re-fetch migrated rows
              const migrated = await fetch(`/api/library/bookmarks?type=${type}`).then((r) => r.json());
              cache[type] = migrated.bookmarks ?? [];
              // Clear from localStorage so migration only runs once
              if (saved.iptv) {
                saved.iptv[oldKey] = [];
                localStorage.setItem('mediavault_config', JSON.stringify(saved));
              }
              notify(type);
              return;
            }
          } catch (e) {
            console.warn('Bookmark migration failed', e);
          }
        }

        cache[type] = dbRows;
        notify(type);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [type]);

  const bookmarkedIds = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);

  const toggle = useCallback(async (item) => {
    const isBookmarked = (cache[type] ?? []).some((b) => b.id === item.id);

    // Optimistic update
    if (isBookmarked) {
      cache[type] = (cache[type] ?? []).filter((b) => b.id !== item.id);
    } else {
      cache[type] = [
        { id: item.id, type, title: item.title ?? item.name, logo: item.logo ?? null, thumb: item.thumb ?? null,
          group_name: item.group ?? item.group_name ?? null, category_id: item.category_id ?? null,
          url: item.url ?? null, year: item.year ?? null, rating: item.rating ?? null,
          source: item.backend === 'seedbox' ? 'seedbox' : 'iptv' },
        ...(cache[type] ?? []),
      ];
    }
    notify(type);

    // Persist to DB
    try {
      if (isBookmarked) {
        await fetch(`/api/library/bookmarks/${encodeURIComponent(item.id)}?type=${type}`, { method: 'DELETE' });
      } else {
        await fetch('/api/library/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id, type,
            title: item.title ?? item.name,
            logo: item.logo ?? null,
            thumb: item.thumb ?? null,
            group_name: item.group ?? item.group_name ?? null,
            category_id: item.category_id ?? null,
            url: item.url ?? null,
            year: item.year ?? null,
            rating: item.rating ?? null,
            source: item.backend === 'seedbox' ? 'seedbox' : 'iptv',
          }),
        });
      }
    } catch (err) {
      // Revert on failure
      console.error('Bookmark sync failed', err);
      const res = await fetch(`/api/library/bookmarks?type=${type}`);
      const data = await res.json();
      cache[type] = data.bookmarks ?? [];
      notify(type);
    }
  }, [type]);

  return { bookmarks, bookmarkedIds, toggle, loading };
}
