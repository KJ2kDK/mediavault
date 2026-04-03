import { createContext, useContext, useState, useCallback } from 'react';

const ConfigContext = createContext(null);

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
    mode: 'none', // 'none' | 'm3u' | 'xtream'
    m3uUrl: '',
    m3uFile: null,
    xtreamBase: '',
    xtreamUser: '',
    xtreamPass: '',
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
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
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

  return (
    <ConfigContext.Provider value={{ config, updateConfig, addRssFeed, removeRssFeed }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
