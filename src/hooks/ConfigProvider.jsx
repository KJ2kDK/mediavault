import { createContext, useState, useCallback, useEffect } from 'react';

export const ConfigContext = createContext(null);

const DEFAULT_CONFIG = {
  qbittorrent: {
    url: '',
    username: '',
    password: '',
    savePath: '/downloads',
    connected: false,
  },
  iptv: {
    mode: 'none',
    m3uUrl: '',
    m3uFile: null,
    xtreamBase: '',
    xtreamUser: '',
    xtreamPass: '',
    hiddenGroups: [],
    hiddenVodGenres: [],
    allGroups: [],
    allVodGenres: [],
    bookmarks: [],    // [{id, name, logo, group, url}]
    vodBookmarks: [],  // [{id, title, thumb, category_id, url, year, rating}]
    supplementalEpgUrls: [], // string[] — extra XMLTV sources merged on top of Xtream EPG
  },
  // rssFeeds is now sourced from the server (/api/rss/feeds) so the list
  // syncs across PC, Shield, phone, etc. The cached array below is hydrated
  // on mount and re-fetched on every mutation. We still keep it on the
  // config object for backward compatibility with components that read
  // config.rssFeeds directly.
  rssFeeds: [],
  predb: { enabled: true, pageSize: 25 },
};

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('mediavault_config');
      if (!saved) return DEFAULT_CONFIG;
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        iptv: {
          ...DEFAULT_CONFIG.iptv,
          ...parsed.iptv,
          vodBookmarks: parsed.iptv?.vodBookmarks ?? [],
          supplementalEpgUrls: parsed.iptv?.supplementalEpgUrls ?? [],
        },
        predb: { ...DEFAULT_CONFIG.predb, ...parsed.predb },
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  const updateConfig = useCallback((section, values) => {
    setConfig((prev) => {
      const next = { ...prev, [section]: { ...prev[section], ...values } };
      localStorage.setItem('mediavault_config', JSON.stringify(next));
      return next;
    });
  }, []);

  // Hydrate rssFeeds from the server on mount + after any mutation.
  // We don't persist them to localStorage anymore — server is the source of truth.
  const reloadRssFeeds = useCallback(async () => {
    try {
      const res = await fetch('/api/rss/feeds');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfig((prev) => ({ ...prev, rssFeeds: data.feeds ?? [] }));
    } catch (err) {
      console.warn('[config] failed to load RSS feeds from server:', err.message);
    }
  }, []);

  // One-time migration: if the user previously had RSS feeds in
  // localStorage (per-browser config), upload any extras to the server so
  // they survive across devices. Server's UNIQUE(url) rejects duplicates;
  // we just fire-and-forget then clear local state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem('mediavault_config');
        const parsed = raw ? JSON.parse(raw) : null;
        const localFeeds = parsed?.rssFeeds ?? [];
        if (!Array.isArray(localFeeds) || localFeeds.length === 0) {
          await reloadRssFeeds();
          return;
        }
        for (const f of localFeeds) {
          if (!f?.name || !f?.url) continue;
          await fetch('/api/rss/feeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: f.name, url: f.url, cookie: f.cookie ?? null, enabled: f.enabled ?? true }),
          }).catch(() => {});
        }
        // Strip rssFeeds from local config — server is now the source of truth.
        if (parsed) {
          delete parsed.rssFeeds;
          localStorage.setItem('mediavault_config', JSON.stringify(parsed));
        }
        if (!cancelled) await reloadRssFeeds();
      } catch (err) {
        console.warn('[config] RSS feed migration skipped:', err.message);
        if (!cancelled) await reloadRssFeeds();
      }
    })();
    return () => { cancelled = true; };
  }, [reloadRssFeeds]);

  const addRssFeed = useCallback(async (feed) => {
    try {
      const res = await fetch('/api/rss/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: feed.name, url: feed.url, cookie: feed.cookie ?? null, enabled: feed.enabled ?? true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    } catch (err) {
      console.error('[config] addRssFeed failed:', err.message);
    } finally {
      reloadRssFeeds();
    }
  }, [reloadRssFeeds]);

  const removeRssFeed = useCallback(async (id) => {
    try {
      await fetch(`/api/rss/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('[config] removeRssFeed failed:', err.message);
    } finally {
      reloadRssFeeds();
    }
  }, [reloadRssFeeds]);

  const updateRssFeed = useCallback(async (id, patch) => {
    try {
      await fetch(`/api/rss/feeds/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.error('[config] updateRssFeed failed:', err.message);
    } finally {
      reloadRssFeeds();
    }
  }, [reloadRssFeeds]);

  return (
    <ConfigContext.Provider value={{ config, updateConfig, addRssFeed, removeRssFeed, updateRssFeed }}>
      {children}
    </ConfigContext.Provider>
  );
}
