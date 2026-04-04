import { createContext, useState, useCallback } from 'react';

export const ConfigContext = createContext(null);

const DEFAULT_CONFIG = {
  plex: {
    serverUrl: '',
    token: '',
    connected: false,
  },
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
  rssFeeds: [
    { id: '1', name: 'TorrentFreak', url: 'https://torrentfreak.com/feed/', enabled: true },
    { id: '2', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', enabled: true },
  ],
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

  const addRssFeed = useCallback((feed) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        rssFeeds: [...prev.rssFeeds, { ...feed, id: Date.now().toString(), enabled: true }],
      };
      localStorage.setItem('mediavault_config', JSON.stringify(next));
      return next;
    });
  }, []);

  const removeRssFeed = useCallback((id) => {
    setConfig((prev) => {
      const next = { ...prev, rssFeeds: prev.rssFeeds.filter((f) => f.id !== id) };
      localStorage.setItem('mediavault_config', JSON.stringify(next));
      return next;
    });
  }, []);

  const updateRssFeed = useCallback((id, patch) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        rssFeeds: prev.rssFeeds.map((f) => f.id === id ? { ...f, ...patch } : f),
      };
      localStorage.setItem('mediavault_config', JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <ConfigContext.Provider value={{ config, updateConfig, addRssFeed, removeRssFeed, updateRssFeed }}>
      {children}
    </ConfigContext.Provider>
  );
}
