import { useState, useEffect, useMemo, useRef } from 'react';
import { useConfig } from '../hooks/useConfig';

// Extract clean title from scene release name (e.g. "Fire.Force.S03E25.1080p.WEB.H264-SKYANiME" → "Fire Force")
function parseTitle(name) {
  if (!name) return '';
  // Cut at common scene tokens
  const cut = name.replace(/[-.](?:S\d{2}E?\d{0,2}|[12]\d{3}|720p|1080p|2160p|4K|WEB|BluRay|BDRip|DVDRip|HDTV|REMASTERED|PROPER|REPACK|iNTERNAL|MULTi|GERMAN|FRENCH|iTALiAN|SPANiSH|DANiSH|NORWEGiAN|POLISH|DUTCH|FiNNiSH|SWEDiSH|DL|FS|WEBRiP|x264|x265|H264|H265|HEVC|XViD|AAC|AC3|DTS|FLAC|MP4|MKV|AVI)[\s.].*/i, '');
  return cut.replace(/\./g, ' ').trim();
}

// Build a TorrentLeech search URL for a given scene release name.
// For TV: title + SxxExx — narrows to that exact episode.
// For movies: title + year if present.
// Otherwise: just the parsed title.
function torrentLeechSearchUrl(rawName) {
  const title = parseTitle(rawName);
  if (!title) return null;
  const ep = rawName?.match(/\bS\d{2}(?:E\d{1,3})?\b/i)?.[0];
  const yr = !ep && rawName?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  const query = [title, ep, yr].filter(Boolean).join(' ');
  return `https://www.torrentleech.org/torrents/browse/index/query/${encodeURIComponent(query)}`;
}

function mediaSearchLinks(name, media) {
  const title = parseTitle(name);
  if (!title) return [];
  const q = encodeURIComponent(title);
  const links = [];
  if (media?.url) links.push({ label: 'IMDB', url: media.url, color: 'text-yellow-500' });
  else links.push({ label: 'IMDB', url: `https://www.imdb.com/find/?q=${q}`, color: 'text-yellow-500' });
  links.push({ label: 'TMDB', url: `https://www.themoviedb.org/search?query=${q}`, color: 'text-sky-400' });
  const tlUrl = torrentLeechSearchUrl(name);
  if (tlUrl) links.push({ label: 'TL', url: tlUrl, color: 'text-orange-400' });
  links.push({ label: 'Trailer', url: `https://www.youtube.com/results?search_query=${q}+trailer`, color: 'text-red-400' });
  links.push({ label: 'Google', url: `https://www.google.com/search?q=${q}`, color: 'text-green-400' });
  return links;
}

const DEMO_NEWS = [
  { id: 'n1', title: 'Major Streaming Platform Announces Price Increase', source: 'TorrentFreak', date: '2h ago', category: 'Streaming', snippet: 'The latest round of price hikes targets premium tier subscribers across multiple regions.' },
  { id: 'n2', title: 'New Linux Kernel Release Brings Significant Performance Gains', source: 'Ars Technica', date: '4h ago', category: 'Tech', snippet: 'Kernel 6.9 introduces optimizations for NVMe storage and network stack improvements.' },
  { id: 'n3', title: 'Court Rules in Favor of Digital Privacy Rights', source: 'TorrentFreak', date: '5h ago', category: 'Privacy', snippet: 'A landmark ruling establishes new precedents for data collection practices.' },
  { id: 'n4', title: 'Self-Hosted Media Servers See Surge in Popularity', source: 'Ars Technica', date: '8h ago', category: 'Self-Hosting', snippet: 'More users are turning to Plex, Jellyfin, and Emby as streaming fragmentation grows.' },
  { id: 'n5', title: 'VPN Industry Responds to New Regulations', source: 'TorrentFreak', date: '12h ago', category: 'Privacy', snippet: 'Major VPN providers update their infrastructure in response to changing legal landscapes.' },
  { id: 'n6', title: 'AI-Powered Video Upscaling Reaches Consumer Hardware', source: 'Ars Technica', date: '1d ago', category: 'Tech', snippet: 'New GPU features enable real-time 4K upscaling of lower resolution content.' },
  { id: 'n7', title: 'Open Source Media Player Gets Major Update', source: 'TorrentFreak', date: '1d ago', category: 'Software', snippet: 'The popular player now supports AV1 hardware decoding and improved subtitle rendering.' },
  { id: 'n8', title: 'ISPs Begin Implementing New Speed Tiers', source: 'Ars Technica', date: '2d ago', category: 'Internet', snippet: 'Symmetrical multi-gigabit connections are becoming available in more markets.' },
];

export default function NewsPage({ navPayload, onClearNavPayload }) {
  const { config, addRssFeed, removeRssFeed, updateRssFeed } = useConfig();
  const [news, setNews]                     = useState(DEMO_NEWS);
  const [loading, setLoading]               = useState(false);
  const [activeSource, setActiveSource]     = useState('All');
  const [showAddFeed, setShowAddFeed]       = useState(false);
  const [newFeed, setNewFeed]               = useState({ name: '', url: '', cookie: '' });
  const [editCookie, setEditCookie]         = useState(null); // { feedId, value }
  const [selectedArticle, setSelectedArticle] = useState(null);
  // { feedName: string[] } — unique categories seen in fetched items
  const [feedCategories, setFeedCategories] = useState({});
  // { feedName: { categoryName: boolean } } — true = show, false = hidden
  const [categoryFilters, setCategoryFilters] = useState({});
  // which feed's category list is expanded in the sidebar
  const [expandedFeed, setExpandedFeed]     = useState(null);
  // per-feed fetch errors
  const [feedErrors, setFeedErrors]         = useState({});
  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState(null); // null = not searching
  const [searchLoading, setSearchLoading]   = useState(false);
  const [sentIds, setSentIds]               = useState({}); // { id: true }
  const [sendingId, setSendingId]           = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(
    () => Number(localStorage.getItem('rss_refresh_interval') ?? 15)
  );
  // ── PreDB state ─────────────────────────────────────────────────────────────
  const [activeView, setActiveView]       = useState('rss'); // 'rss' | 'predb'
  const [predbReleases, setPredbReleases] = useState([]);
  const [predbLoading, setPredbLoading]   = useState(false);
  const [predbTotal, setPredbTotal]       = useState(0);
  const [predbPage, setPredbPage]         = useState(1);
  const [predbSearch, setPredbSearch]     = useState('');
  const [predbCat, setPredbCat]           = useState('');
  const [predbStats, setPredbStats]       = useState(null);
  const [selectedRelease, setSelectedRelease] = useState(null);
  const [predbCatFilters, setPredbCatFilters] = useState({}); // { catName: false } = hidden

  // ── PreDB.net state ────────────────────────────────────────────────────────
  const [pnetReleases, setPnetReleases]     = useState([]);
  const [pnetLoading, setPnetLoading]       = useState(false);
  const [pnetTotal, setPnetTotal]           = useState(0);
  const [pnetPage, setPnetPage]             = useState(1);
  const [pnetSearch, setPnetSearch]         = useState('');
  const [pnetCat, setPnetCat]               = useState('');
  const [pnetCatFilters, setPnetCatFilters] = useState({});
  const [selectedPnet, setSelectedPnet]     = useState(null);
  const [nfoData, setNfoData]               = useState({}); // { releaseName: string|null }
  const [nfoLoading, setNfoLoading]         = useState(null);

  const searchTimer = useRef(null);
  const refreshTimer = useRef(null);
  const predbTimer = useRef(null);
  const pnetTimer = useRef(null);

  const PREDB_CATS = [
    { label: 'All', value: '' },
    { label: 'TV', value: 'TV' },
    { label: 'Movies', value: 'MOVIES' },
    { label: 'Music', value: 'FLAC' },
    { label: 'Games', value: 'GAMES' },
    { label: 'Apps', value: '0DAY' },
    { label: 'Ebooks', value: 'EBOOK' },
    { label: 'XXX', value: 'XXX' },
  ];

  const sources = ['All', ...config.rssFeeds.map((f) => f.name)];

  // Handle navigation payload from chat assistant
  useEffect(() => {
    if (navPayload?.search) {
      setSearchQuery(navPayload.search);
      doSearch(navPayload.search);
      onClearNavPayload?.();
    }
  }, [navPayload]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: load cached items from DB instantly, then background-refresh RSS feeds
  useEffect(() => {
    const enabled = config.rssFeeds.filter((f) => f.enabled);
    if (enabled.length === 0) return;
    // 1. Instant load from DB
    loadFromDb().then((hadItems) => {
      // 2. Background refresh from RSS (no loading spinner)
      backgroundRefreshFeeds();
    });
  }, [config.rssFeeds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh on interval
  useEffect(() => {
    clearInterval(refreshTimer.current);
    if (refreshInterval > 0) {
      refreshTimer.current = setInterval(() => fetchFeeds(), refreshInterval * 60 * 1000);
    }
    return () => clearInterval(refreshTimer.current);
  }, [refreshInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIntervalChange = (mins) => {
    setRefreshInterval(mins);
    localStorage.setItem('rss_refresh_interval', String(mins));
  };

  // ── PreDB fetching ────────────────────────────────────────────────────────
  const fetchPredb = async (page = predbPage, search = predbSearch, cat = predbCat) => {
    setPredbLoading(true);
    try {
      const params = new URLSearchParams({ count: '25', page: String(page) });
      if (search.trim()) params.set('q', search.trim());
      if (cat) params.set('cat', cat);
      const res = await fetch(`/api/predb/releases?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPredbReleases(data.releases || []);
      setPredbTotal(data.total || 0);
      setPredbPage(data.page || page);
    } catch { setPredbReleases([]); }
    finally { setPredbLoading(false); }
  };

  const fetchPredbStats = async () => {
    try {
      const res = await fetch('/api/predb/stats');
      const data = await res.json();
      if (!data.error) setPredbStats(data);
    } catch { /* silent */ }
  };

  // Fetch predb on view switch or mount
  useEffect(() => {
    if (activeView === 'predb' && predbReleases.length === 0) {
      fetchPredb(1);
      fetchPredbStats();
    }
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  // PreDB auto-refresh
  useEffect(() => {
    clearInterval(predbTimer.current);
    if (activeView === 'predb' && refreshInterval > 0) {
      predbTimer.current = setInterval(() => fetchPredb(), refreshInterval * 60 * 1000);
    }
    return () => clearInterval(predbTimer.current);
  }, [activeView, refreshInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePredbSearch = (val) => {
    setPredbSearch(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { searchTimer.current = setTimeout(() => fetchPredb(1, '', predbCat), 100); return; }
    searchTimer.current = setTimeout(() => fetchPredb(1, val, predbCat), 350);
  };

  const handlePredbCat = (cat) => {
    setPredbCat(cat);
    setPredbPage(1);
    fetchPredb(1, predbSearch, cat);
  };

  const totalPredbPages = Math.max(1, Math.ceil(predbTotal / 25));

  // Unique categories from loaded releases + client-side filtering
  const predbUniqueCats = useMemo(() => {
    const cats = new Set();
    for (const r of predbReleases) if (r.cat) cats.add(r.cat);
    return [...cats].sort();
  }, [predbReleases]);

  const filteredPredb = useMemo(() => {
    const hasFilters = Object.values(predbCatFilters).some((v) => v === false);
    if (!hasFilters) return predbReleases;
    return predbReleases.filter((r) => predbCatFilters[r.cat] !== false);
  }, [predbReleases, predbCatFilters]);

  // ── PreDB.net fetching ─────────────────────────────────────────────────────
  const PNET_CATS = [
    { label: 'All', value: '' },
    { label: 'TV', value: 'TV' },
    { label: 'Movies', value: 'X264' },
    { label: 'Music', value: 'MP3' },
    { label: 'Games', value: 'GAMES' },
    { label: 'Apps', value: '0DAY' },
    { label: 'Ebooks', value: 'EBOOK' },
    { label: 'XXX', value: 'XXX' },
  ];

  const fetchPnet = async (page = pnetPage, search = pnetSearch, cat = pnetCat) => {
    setPnetLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25', page: String(page) });
      if (search.trim()) params.set('q', search.trim());
      if (cat) params.set('section', cat);
      const res = await fetch(`/api/predbnet/releases?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPnetReleases(data.releases || []);
      setPnetTotal(data.total || 0);
      setPnetPage(data.page || page);
    } catch { setPnetReleases([]); }
    finally { setPnetLoading(false); }
  };

  const fetchNfo = async (releaseName) => {
    if (nfoData[releaseName] !== undefined) return;
    setNfoLoading(releaseName);
    try {
      const res = await fetch(`/api/predbnet/nfo?name=${encodeURIComponent(releaseName)}`);
      const data = await res.json();
      setNfoData((prev) => ({ ...prev, [releaseName]: data.nfo || null }));
    } catch {
      setNfoData((prev) => ({ ...prev, [releaseName]: null }));
    } finally { setNfoLoading(null); }
  };

  useEffect(() => {
    if (activeView === 'pnet' && pnetReleases.length === 0) fetchPnet(1);
  }, [activeView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clearInterval(pnetTimer.current);
    if (activeView === 'pnet' && refreshInterval > 0) {
      pnetTimer.current = setInterval(() => fetchPnet(), refreshInterval * 60 * 1000);
    }
    return () => clearInterval(pnetTimer.current);
  }, [activeView, refreshInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePnetSearch = (val) => {
    setPnetSearch(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { searchTimer.current = setTimeout(() => fetchPnet(1, '', pnetCat), 100); return; }
    searchTimer.current = setTimeout(() => fetchPnet(1, val, pnetCat), 350);
  };

  const handlePnetCat = (cat) => {
    setPnetCat(cat);
    setPnetPage(1);
    fetchPnet(1, pnetSearch, cat);
  };

  const totalPnetPages = Math.max(1, Math.ceil(pnetTotal / 25));

  const pnetUniqueCats = useMemo(() => {
    const cats = new Set();
    for (const r of pnetReleases) if (r.cat) cats.add(r.cat);
    return [...cats].sort();
  }, [pnetReleases]);

  const filteredPnet = useMemo(() => {
    const hasFilters = Object.values(pnetCatFilters).some((v) => v === false);
    if (!hasFilters) return pnetReleases;
    return pnetReleases.filter((r) => pnetCatFilters[r.cat] !== false);
  }, [pnetReleases, pnetCatFilters]);

  // Apply source + category filters
  const filtered = useMemo(() => {
    const bySource = activeSource === 'All' ? news : news.filter((n) => n.source === activeSource);
    return bySource.filter((item) => {
      const srcFilters = categoryFilters[item.source];
      if (!srcFilters || Object.keys(srcFilters).length === 0) return true;
      const cat = item.category || 'Uncategorized';
      return srcFilters[cat] !== false;
    });
  }, [news, activeSource, categoryFilters]);

  // Browser-proxy fetch: opens feed URL in a popup, fetches XML via same-origin,
  // and POSTs it to the server's ingest endpoint. Bypasses Cloudflare because the
  // browser has solved the JS challenge and carries the cf_clearance cookie.
  const browserFetchFeed = async (feed) => {
    return new Promise((resolve) => {
      const popup = window.open(feed.url, '_blank', 'width=1,height=1,left=-9999,top=-9999');
      if (!popup) { resolve(null); return; }
      const timer = setTimeout(() => { try { popup.close(); } catch {} resolve(null); }, 20000);
      const check = setInterval(async () => {
        try {
          // Wait for the page to load and try same-origin fetch from within the popup
          if (popup.closed) { clearInterval(check); clearTimeout(timer); resolve(null); return; }
          // Try fetching from the popup's context (same-origin = cookies included)
          const xml = await new Promise((res, rej) => {
            try {
              const script = popup.document.createElement('script');
              script.textContent = `
                fetch(location.href, { credentials: 'include' })
                  .then(r => r.text())
                  .then(t => { window.__rssXml = t; })
                  .catch(() => { window.__rssXml = null; });
              `;
              popup.document.head.appendChild(script);
              setTimeout(() => res(popup.__rssXml), 3000);
            } catch { rej(); }
          });
          if (xml && xml.includes('<rss') && !xml.includes('Just a moment')) {
            clearInterval(check);
            clearTimeout(timer);
            popup.close();
            // POST to ingest endpoint
            const resp = await fetch('/api/rss-ingest/ingest-xml', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedName: feed.name, xml }),
            });
            const data = await resp.json();
            // Reload from DB
            const search = await fetch(`/api/rss/search?source=${encodeURIComponent(feed.name)}&limit=100`);
            const searchData = await search.json();
            resolve(searchData.items || []);
          }
        } catch {
          // Cross-origin — can't access popup content yet, keep waiting
        }
      }, 2000);
    });
  };

  // ── Shared helper: apply items array to state ──────────────────────────────
  const applyItems = (items, merge = false) => {
    if (!items?.length) return;
    const catMap = {};
    for (const item of items) {
      const cats = item.categories?.length ? item.categories : [item.category || 'Uncategorized'];
      if (!catMap[item.source]) catMap[item.source] = new Set();
      for (const cat of cats) catMap[item.source].add(cat);
    }
    setFeedCategories((prev) => {
      const next = { ...prev };
      for (const [src, catSet] of Object.entries(catMap)) {
        next[src] = [...catSet].sort();
      }
      return next;
    });
    setCategoryFilters((prev) => {
      const next = { ...prev };
      for (const [src, catSet] of Object.entries(catMap)) {
        if (!next[src]) next[src] = {};
        for (const cat of catSet) {
          if (!(cat in next[src])) next[src][cat] = true;
        }
      }
      return next;
    });
    if (merge) {
      setNews((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const merged = [...prev];
        for (const it of items) if (!existing.has(it.id)) merged.push(it);
        merged.sort((a, b) => (b.pubDateSec || 0) - (a.pubDateSec || 0));
        return merged;
      });
    } else {
      setNews(items);
    }
    const sent = {};
    for (const it of items) if (it.sentAt) sent[it.id] = true;
    setSentIds((prev) => ({ ...prev, ...sent }));
  };

  // ── Load cached items from DB (instant) ───────────────────────────────────
  const loadFromDb = async () => {
    try {
      const res = await fetch(`/api/rss/search?limit=500`);
      const data = await res.json();
      if (data.items?.length > 0) {
        applyItems(data.items);
        setLoading(false);
        return true;
      }
    } catch {}
    return false;
  };

  // ── Background refresh: fetch RSS feeds silently, merge new items ─────────
  const backgroundRefreshFeeds = async () => {
    try {
      const res = await fetch('/api/rss/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: config.rssFeeds.filter((f) => f.enabled) }),
      });
      const data = await res.json();
      if (data.errors?.length) {
        const errMap = {};
        const cfBlocked = [];
        for (const e of data.errors) {
          errMap[e.name] = e.error;
          if (e.error?.includes('Cloudflare')) {
            const feed = config.rssFeeds.find((f) => f.name === e.name);
            if (feed) cfBlocked.push(feed);
          }
        }
        setFeedErrors(errMap);
        if (cfBlocked.length) {
          for (const feed of cfBlocked) {
            browserFetchFeed(feed).then((items) => {
              if (items?.length) {
                setFeedErrors((prev) => { const next = { ...prev }; delete next[feed.name]; return next; });
                applyItems(items, true);
              }
            }).catch(() => {});
          }
        }
      } else {
        setFeedErrors({});
      }
      if (data.items?.length > 0) {
        applyItems(data.items, true);
      }
    } catch {}
  };

  // ── Full fetch (used by manual Refresh button) ────────────────────────────
  const fetchFeeds = async () => {
    setLoading(true);
    try {
      await backgroundRefreshFeeds();
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (feedName, cat) => {
    setCategoryFilters((prev) => ({
      ...prev,
      [feedName]: { ...prev[feedName], [cat]: !prev[feedName]?.[cat] },
    }));
  };

  const setAllCategories = (feedName, enabled) => {
    setCategoryFilters((prev) => {
      const cats = feedCategories[feedName] ?? [];
      const next = { ...prev, [feedName]: {} };
      for (const cat of cats) next[feedName][cat] = enabled;
      return next;
    });
  };

  const handleAddFeed = () => {
    if (!newFeed.name || !newFeed.url) return;
    addRssFeed(newFeed);
    setNewFeed({ name: '', url: '' });
    setShowAddFeed(false);
  };

  const doSearch = async (q) => {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: 200 });
      if (activeSource !== 'All') params.set('source', activeSource);
      const res = await fetch(`/api/rss/search?${params}`);
      const data = await res.json();
      setSearchResults(data.items ?? []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(() => doSearch(val), 350);
  };

  const handleSendToDownloads = async (article) => {
    if (!article.torrentUrl || sentIds[article.id] || sendingId === article.id) return;
    setSendingId(article.id);
    try {
      const res = await fetch('/api/rss/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: article.id, torrentUrl: article.torrentUrl }),
      });
      const data = await res.json();
      if (data.success) setSentIds((prev) => ({ ...prev, [article.id]: true }));
    } catch { /* silent */ }
    finally { setSendingId(null); }
  };

  return (
    <div className="flex h-full animate-fade-in">
      {/* Feed list */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-vault-border flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-x-auto carousel-row">
            {/* View toggle */}
            <div className="flex rounded-lg border border-vault-border overflow-hidden shrink-0">
              <button
                onClick={() => setActiveView('rss')}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${activeView === 'rss' ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-vault-text'}`}
              >
                RSS Feeds
              </button>
              <button
                onClick={() => setActiveView('predb')}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${activeView === 'predb' ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-vault-text'}`}
              >
                PreDB.club
              </button>
              <button
                onClick={() => setActiveView('pnet')}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${activeView === 'pnet' ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-vault-text'}`}
              >
                PreDB.net
              </button>
            </div>
            {/* RSS source tabs (only when RSS view active) */}
            {activeView === 'rss' && sources.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSource(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeSource === s
                    ? 'bg-vault-accent text-white'
                    : 'bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border'
                }`}
              >
                {s}
              </button>
            ))}
            {/* Category chips for scene release views */}
            {activeView === 'predb' && PREDB_CATS.map((c) => (
              <button
                key={c.value}
                onClick={() => handlePredbCat(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  predbCat === c.value
                    ? 'bg-vault-accent text-white'
                    : 'bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border'
                }`}
              >
                {c.label}
              </button>
            ))}
            {activeView === 'pnet' && PNET_CATS.map((c) => (
              <button
                key={c.value}
                onClick={() => handlePnetCat(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  pnetCat === c.value
                    ? 'bg-vault-accent text-white'
                    : 'bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {/* Auto-refresh interval */}
            <select
              value={refreshInterval}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg bg-vault-card border border-vault-border text-xs text-vault-muted focus:outline-none"
              title="Auto-refresh interval"
            >
              <option value={0}>Manual</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
            {/* Search box */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                value={activeView === 'rss' ? searchQuery : activeView === 'predb' ? predbSearch : pnetSearch}
                onChange={(e) => {
                  if (activeView === 'rss') handleSearchChange(e.target.value);
                  else if (activeView === 'predb') handlePredbSearch(e.target.value);
                  else handlePnetSearch(e.target.value);
                }}
                placeholder={activeView === 'rss' ? 'Search history...' : 'Search releases...'}
                className="pl-7 pr-3 py-1.5 rounded-lg bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50 w-44"
              />
              {(activeView === 'rss' ? searchQuery : activeView === 'predb' ? predbSearch : pnetSearch) && (
                <button onClick={() => {
                  if (activeView === 'rss') { setSearchQuery(''); setSearchResults(null); }
                  else if (activeView === 'predb') { setPredbSearch(''); fetchPredb(1, '', predbCat); }
                  else { setPnetSearch(''); fetchPnet(1, '', pnetCat); }
                }} className="absolute right-2 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-text">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <button
              onClick={() => activeView === 'rss' ? fetchFeeds() : activeView === 'predb' ? fetchPredb(1) : fetchPnet(1)}
              className="p-2 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors"
              title="Refresh"
            >
              <svg className={`w-4 h-4 ${(activeView === 'rss' ? loading : activeView === 'predb' ? predbLoading : pnetLoading) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
            {activeView === 'rss' && (
              <button
                onClick={() => setShowAddFeed(!showAddFeed)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-vault-teal/15 text-vault-teal hover:bg-vault-teal/25 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Feed
              </button>
            )}
          </div>
        </div>

        {/* Add feed form */}
        {showAddFeed && (
          <div className="px-6 py-3 border-b border-vault-border bg-vault-card/30 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Feed name"
                value={newFeed.name}
                onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                className="px-3 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text w-40 focus:outline-none focus:border-vault-accent/50"
              />
              <input
                type="text"
                placeholder="RSS URL"
                value={newFeed.url}
                onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
                className="flex-1 px-3 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
              />
              <button onClick={handleAddFeed} className="px-3 py-1.5 rounded-md bg-vault-accent text-white text-xs hover:bg-vault-accentHover shrink-0">
                Add
              </button>
              <button onClick={() => setShowAddFeed(false)} className="text-vault-muted hover:text-vault-text text-xs shrink-0">
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-vault-muted shrink-0">Cookie (optional, for sites requiring login):</span>
              <input
                type="password"
                placeholder="Paste cookie string here"
                value={newFeed.cookie}
                onChange={(e) => setNewFeed({ ...newFeed, cookie: e.target.value })}
                className="flex-1 px-3 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-teal/50 font-mono"
              />
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {activeView === 'rss' ? (
            <>
              {searchResults !== null && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-vault-muted">{searchLoading ? 'Searching…' : `${searchResults.length} results for "${searchQuery}"`}</span>
                </div>
              )}
              {(searchResults ?? filtered).length === 0 && !loading && !searchLoading && (
                <div className="text-center text-vault-muted text-sm py-16">
                  {searchResults !== null ? 'No results found.' : news === DEMO_NEWS ? 'Add a feed and click refresh to load articles.' : 'No articles match the selected categories.'}
                </div>
              )}
              {(searchResults ?? filtered).map((article) => (
                <article
                  key={article.id}
                  onClick={() => setSelectedArticle(selectedArticle?.id === article.id ? null : article)}
                  className={`p-4 rounded-lg border transition-all cursor-pointer ${
                    selectedArticle?.id === article.id
                      ? 'bg-vault-card border-vault-accent/30'
                      : 'bg-vault-surface/50 border-vault-border hover:bg-vault-card hover:border-vault-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-vault-teal">{article.source}</span>
                        <span className="text-[10px] text-vault-muted">•</span>
                        <span className="text-[10px] text-vault-muted">{article.date}</span>
                        {article.category && (
                          <>
                            <span className="text-[10px] text-vault-muted">•</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-vault-card text-vault-muted">{article.category}</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-sm font-medium text-vault-text leading-snug">{article.title}</h3>
                      {/* UNIT3D torrent metadata badges */}
                      {article.meta && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {article.meta.resolution && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">{article.meta.resolution}</span>
                          )}
                          {article.meta.type && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">{article.meta.type}</span>
                          )}
                          {article.meta.size && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-vault-accent/15 text-vault-accent">{article.meta.size}</span>
                          )}
                          {(article.meta.seeders !== undefined || article.meta.leechers !== undefined) && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-vault-surface flex items-center gap-1">
                              <span className="text-green-400">▲{article.meta.seeders ?? 0}</span>
                              <span className="text-vault-muted">/</span>
                              <span className="text-red-400">▼{article.meta.leechers ?? 0}</span>
                            </span>
                          )}
                          {article.meta.completed > 0 && (
                            <span className="text-[10px] text-vault-muted px-1.5 py-0.5 rounded bg-vault-surface">✓{article.meta.completed}</span>
                          )}
                        </div>
                      )}
                      {article.snippet && !article.meta && (
                        <p className="text-xs text-vault-muted mt-1 line-clamp-2">{article.snippet}</p>
                      )}
                      {/* Expanded detail area for selected article */}
                      {selectedArticle?.id === article.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {article.meta?.imdbId && (
                            <a
                              href={`https://www.imdb.com/title/${article.meta.imdbId}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25 transition-colors"
                            >
                              IMDb
                            </a>
                          )}
                          {article.meta?.tmdbId && (
                            <a
                              href={`https://www.themoviedb.org/movie/${article.meta.tmdbId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 transition-colors"
                            >
                              TMDB
                            </a>
                          )}
                          {article.meta?.uploader && (
                            <span className="text-[10px] text-vault-muted">by {article.meta.uploader}</span>
                          )}
                          {(() => {
                            const tlUrl = torrentLeechSearchUrl(article.title);
                            return tlUrl ? (
                              <a
                                href={tlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors"
                                title="Search TorrentLeech for this title"
                              >
                                Search TL
                              </a>
                            ) : null;
                          })()}
                          {article.link && (
                            <a
                              href={article.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] text-vault-teal hover:underline"
                            >
                              Open article →
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {article.torrentUrl && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSendToDownloads(article); }}
                        disabled={!!sentIds[article.id] || sendingId === article.id}
                        title={sentIds[article.id] ? 'Already sent to qBittorrent' : 'Send to qBittorrent'}
                        className={`shrink-0 p-2 rounded-lg transition-colors ${
                          sentIds[article.id]
                            ? 'text-green-500 bg-green-500/10 cursor-default'
                            : sendingId === article.id
                              ? 'text-vault-muted animate-pulse cursor-wait'
                              : 'text-vault-muted hover:text-vault-accent hover:bg-vault-accent/10'
                        }`}
                      >
                        {sentIds[article.id] ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </>
          ) : activeView === 'predb' ? (
            <>
              {/* PreDB releases */}
              {predbLoading && predbReleases.length === 0 && (
                <div className="text-center text-vault-muted text-sm py-16">Loading releases...</div>
              )}
              {!predbLoading && filteredPredb.length === 0 && (
                <div className="text-center text-vault-muted text-sm py-16">No releases found.</div>
              )}
              {filteredPredb.map((rel) => {
                const isOpen = selectedRelease === rel.id;
                return (
                  <article
                    key={rel.id}
                    onClick={() => setSelectedRelease(isOpen ? null : rel.id)}
                    className={`p-4 rounded-lg border transition-all cursor-pointer ${
                      isOpen
                        ? 'bg-vault-card border-vault-accent/30'
                        : 'bg-vault-surface/50 border-vault-border hover:bg-vault-card hover:border-vault-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-vault-teal/15 text-vault-teal">{rel.cat}</span>
                      <span className="text-[10px] text-vault-muted">•</span>
                      <span className="text-[10px] text-vault-muted">{rel.time}</span>
                      {rel.team && (
                        <>
                          <span className="text-[10px] text-vault-muted">•</span>
                          <span className="text-[10px] text-vault-muted">Group: <span className="text-vault-text font-medium">{rel.team}</span></span>
                        </>
                      )}
                      {rel.nuke && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400" title={rel.nuke.reason || ''}>
                          {rel.nuke.type || 'NUKED'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-vault-text font-mono leading-snug break-all">{rel.name}</p>
                    {/* Expanded details */}
                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-vault-border/50 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {rel.size && (
                            <span className="text-[11px] text-vault-muted">Size: <span className="text-vault-text">{rel.size}</span></span>
                          )}
                          {rel.files > 0 && (
                            <span className="text-[11px] text-vault-muted">Files: <span className="text-vault-text">{rel.files}</span></span>
                          )}
                          <span className="text-[11px] text-vault-muted">Category: <span className="text-vault-text">{rel.cat}</span></span>
                          {rel.team && (
                            <span className="text-[11px] text-vault-muted">Group: <span className="text-vault-text">{rel.team}</span></span>
                          )}
                          {rel.preAt && (
                            <span className="text-[11px] text-vault-muted">Pre: <span className="text-vault-text">{new Date(rel.preAt * 1000).toLocaleString()}</span></span>
                          )}
                        </div>
                        {rel.media && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {rel.media.rating && <span className="text-[11px] text-yellow-500 font-medium">IMDB {rel.media.rating}/10</span>}
                            {rel.media.year && <span className="text-[11px] text-vault-muted">{rel.media.year}</span>}
                            {rel.media.genre && <span className="text-[11px] text-vault-muted">{rel.media.genre}</span>}
                            {rel.media.url && (
                              <a href={rel.media.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-vault-teal hover:underline">
                                View on IMDB →
                              </a>
                            )}
                          </div>
                        )}
                        {rel.nuke?.reason && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{rel.nuke.type || 'NUKED'}</span>
                            <span className="text-[11px] text-red-400/80 italic">{rel.nuke.reason}</span>
                          </div>
                        )}
                        <a
                          href={`https://predb.club/?id=${rel.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-block text-[10px] text-vault-teal hover:underline"
                        >
                          View on PreDB →
                        </a>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-vault-muted">Find on:</span>
                          {mediaSearchLinks(rel.name, rel.media).map((l) => (
                            <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`text-[10px] ${l.color} hover:underline`}>
                              {l.label}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
              {/* Pagination */}
              {predbTotal > 25 && (
                <div className="flex items-center justify-center gap-4 pt-4 pb-2">
                  <button
                    onClick={() => { const p = Math.max(1, predbPage - 1); setPredbPage(p); fetchPredb(p); }}
                    disabled={predbPage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-muted hover:text-vault-text disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-vault-muted">Page {predbPage} of {totalPredbPages}</span>
                  <button
                    onClick={() => { const p = Math.min(totalPredbPages, predbPage + 1); setPredbPage(p); fetchPredb(p); }}
                    disabled={predbPage >= totalPredbPages}
                    className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-muted hover:text-vault-text disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : activeView === 'pnet' ? (
            <>
              {/* PreDB.net releases */}
              {pnetLoading && pnetReleases.length === 0 && (
                <div className="text-center text-vault-muted text-sm py-16">Loading releases...</div>
              )}
              {!pnetLoading && filteredPnet.length === 0 && (
                <div className="text-center text-vault-muted text-sm py-16">No releases found.</div>
              )}
              {filteredPnet.map((rel) => {
                const isOpen = selectedPnet === rel.id;
                return (
                  <article
                    key={rel.id}
                    onClick={() => { setSelectedPnet(isOpen ? null : rel.id); if (!isOpen) fetchNfo(rel.name); }}
                    className={`p-4 rounded-lg border transition-all cursor-pointer ${
                      isOpen
                        ? 'bg-vault-card border-vault-accent/30'
                        : 'bg-vault-surface/50 border-vault-border hover:bg-vault-card hover:border-vault-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-vault-teal/15 text-vault-teal">{rel.cat}</span>
                      <span className="text-[10px] text-vault-muted">{rel.time}</span>
                      {rel.team && (
                        <>
                          <span className="text-[10px] text-vault-muted">•</span>
                          <span className="text-[10px] text-vault-muted">Group: <span className="text-vault-text font-medium">{rel.team}</span></span>
                        </>
                      )}
                      {rel.genre && (
                        <>
                          <span className="text-[10px] text-vault-muted">•</span>
                          <span className="text-[10px] text-vault-muted">{rel.genre}</span>
                        </>
                      )}
                      {rel.nuke && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400" title={rel.nuke.reason || ''}>
                          {rel.nuke.type}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-vault-text font-mono leading-snug break-all">{rel.name}</p>
                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-vault-border/50 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {rel.size && <span className="text-[11px] text-vault-muted">Size: <span className="text-vault-text">{rel.size}</span></span>}
                          {rel.files > 0 && <span className="text-[11px] text-vault-muted">Files: <span className="text-vault-text">{rel.files}</span></span>}
                          <span className="text-[11px] text-vault-muted">Section: <span className="text-vault-text">{rel.cat}</span></span>
                          {rel.preAt && <span className="text-[11px] text-vault-muted">Pre: <span className="text-vault-text">{new Date(rel.preAt * 1000).toLocaleString()}</span></span>}
                        </div>
                        {rel.nuke?.reason && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{rel.nuke.type}</span>
                            <span className="text-[11px] text-red-400/80 italic">{rel.nuke.reason}</span>
                          </div>
                        )}
                        {/* NFO viewer */}
                        {nfoLoading === rel.name && (
                          <p className="text-[11px] text-vault-muted italic">Loading NFO...</p>
                        )}
                        {nfoData[rel.name] && (
                          <div className="mt-2">
                            <p className="text-[10px] text-vault-muted uppercase tracking-wider font-semibold mb-1">NFO</p>
                            <pre className="bg-vault-bg border border-vault-border rounded p-3 text-[10px] text-vault-text font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre leading-tight">{nfoData[rel.name]}</pre>
                          </div>
                        )}
                        {nfoData[rel.name] === null && nfoLoading !== rel.name && (
                          <p className="text-[10px] text-vault-muted italic">No NFO available</p>
                        )}
                        {rel.url && (
                          <a
                            href={rel.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-block text-[10px] text-vault-teal hover:underline"
                          >
                            View on PreDB.net →
                          </a>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-vault-muted">Find on:</span>
                          {mediaSearchLinks(rel.name, null).map((l) => (
                            <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`text-[10px] ${l.color} hover:underline`}>
                              {l.label}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
              {pnetTotal > 25 && (
                <div className="flex items-center justify-center gap-4 pt-4 pb-2">
                  <button
                    onClick={() => { const p = Math.max(1, pnetPage - 1); setPnetPage(p); fetchPnet(p); }}
                    disabled={pnetPage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-muted hover:text-vault-text disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-vault-muted">Page {pnetPage} of {totalPnetPages}</span>
                  <button
                    onClick={() => { const p = Math.min(totalPnetPages, pnetPage + 1); setPnetPage(p); fetchPnet(p); }}
                    disabled={pnetPage >= totalPnetPages}
                    className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-muted hover:text-vault-text disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-64 shrink-0 border-l border-vault-border bg-vault-surface/50 flex flex-col">
        {activeView === 'pnet' ? (
          <>
            <div className="px-4 py-3 border-b border-vault-border">
              <h3 className="text-xs font-bold uppercase tracking-widest text-vault-muted">PreDB.net</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="text-[10px] text-vault-muted space-y-1">
                <p>Scene releases with NFO support.</p>
                <p>Click a release to view details and NFO.</p>
              </div>
              {pnetTotal > 0 && (
                <div className="pt-2 border-t border-vault-border">
                  <p className="text-[10px] text-vault-muted">{pnetTotal.toLocaleString()} results{pnetCat ? ` in ${pnetCat}` : ''}{pnetSearch ? ` for "${pnetSearch}"` : ''}</p>
                </div>
              )}
              {pnetUniqueCats.length > 0 && (
                <div className="pt-2 border-t border-vault-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-vault-muted uppercase tracking-wider font-semibold">Categories</p>
                    <div className="flex gap-2">
                      <button onClick={() => setPnetCatFilters({})} className="text-[10px] text-vault-teal hover:underline">All</button>
                      <button onClick={() => { const f = {}; pnetUniqueCats.forEach((c) => f[c] = false); setPnetCatFilters(f); }} className="text-[10px] text-vault-muted hover:underline">None</button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {pnetUniqueCats.map((cat) => (
                      <label key={cat} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={pnetCatFilters[cat] !== false}
                          onChange={() => setPnetCatFilters((prev) => ({ ...prev, [cat]: prev[cat] === false ? true : false }))}
                          className="w-3 h-3 rounded accent-vault-teal cursor-pointer"
                        />
                        <span className="text-[11px] text-vault-text group-hover:text-white transition-colors truncate">{cat}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeView === 'predb' ? (
          <>
            <div className="px-4 py-3 border-b border-vault-border">
              <h3 className="text-xs font-bold uppercase tracking-widest text-vault-muted">PreDB Stats</h3>
            </div>
            <div className="p-3 space-y-3">
              {predbStats ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Today', value: predbStats.today?.toLocaleString() },
                    { label: 'This Week', value: predbStats.week?.toLocaleString() },
                    { label: 'This Month', value: predbStats.month?.toLocaleString() },
                    { label: 'Total', value: predbStats.total?.toLocaleString() },
                  ].map((s) => (
                    <div key={s.label} className="p-2 rounded-lg bg-vault-card border border-vault-border text-center">
                      <p className="text-sm font-bold text-vault-text">{s.value}</p>
                      <p className="text-[10px] text-vault-muted uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-vault-muted">Loading stats...</p>
              )}
              <div className="pt-2 border-t border-vault-border">
                <p className="text-[10px] text-vault-muted mb-2 uppercase tracking-wider font-semibold">Search Tips</p>
                <div className="space-y-1 text-[10px] text-vault-muted">
                  <p><span className="text-vault-text font-mono">@team SPARKS</span> — by group</p>
                  <p><span className="text-vault-text font-mono">@cat TV-1080P</span> — exact category</p>
                  <p><span className="text-vault-text font-mono">fire force</span> — by name</p>
                </div>
              </div>
              {predbTotal > 0 && (
                <div className="pt-2 border-t border-vault-border">
                  <p className="text-[10px] text-vault-muted">{predbTotal.toLocaleString()} results{predbCat ? ` in ${predbCat}` : ''}{predbSearch ? ` for "${predbSearch}"` : ''}</p>
                </div>
              )}
              {predbUniqueCats.length > 0 && (
                <div className="pt-2 border-t border-vault-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-vault-muted uppercase tracking-wider font-semibold">Categories</p>
                    <div className="flex gap-2">
                      <button onClick={() => setPredbCatFilters({})} className="text-[10px] text-vault-teal hover:underline">All</button>
                      <button onClick={() => { const f = {}; predbUniqueCats.forEach((c) => f[c] = false); setPredbCatFilters(f); }} className="text-[10px] text-vault-muted hover:underline">None</button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {predbUniqueCats.map((cat) => (
                      <label key={cat} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={predbCatFilters[cat] !== false}
                          onChange={() => setPredbCatFilters((prev) => ({ ...prev, [cat]: prev[cat] === false ? true : false }))}
                          className="w-3 h-3 rounded accent-vault-teal cursor-pointer"
                        />
                        <span className="text-[11px] text-vault-text group-hover:text-white transition-colors truncate">{cat}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
        <div className="px-4 py-3 border-b border-vault-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-vault-muted">Managed Feeds</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {config.rssFeeds.map((feed) => {
            const cats = feedCategories[feed.name] ?? [];
            const filters = categoryFilters[feed.name] ?? {};
            const isExpanded = expandedFeed === feed.id;
            const enabledCount = cats.filter((c) => filters[c] !== false).length;

            return (
              <div key={feed.id} className="rounded-lg border border-vault-border overflow-hidden">
                {/* Feed header row */}
                <div className="flex items-center gap-2 p-2 bg-vault-card/50">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${feed.enabled ? 'bg-green-500' : 'bg-vault-muted/30'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-vault-text truncate">{feed.name}</p>
                    {feedErrors[feed.name]
                      ? <p className="text-[10px] text-red-400 truncate" title={feedErrors[feed.name]}>⚠ {feedErrors[feed.name]}</p>
                      : cats.length > 0
                        ? <p className="text-[10px] text-vault-muted">{enabledCount}/{cats.length} categories</p>
                        : null
                    }
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Cookie button */}
                    <button
                      onClick={() => setEditCookie(editCookie?.feedId === feed.id ? null : { feedId: feed.id, value: feed.cookie || '' })}
                      className={`p-1 rounded transition-colors ${feed.cookie ? 'text-vault-teal' : 'text-vault-muted/50 hover:text-vault-muted'}`}
                      title={feed.cookie ? 'Cookie set — click to edit' : 'Add cookie for login-required feeds'}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </button>
                    {cats.length > 0 && (
                      <button
                        onClick={() => setExpandedFeed(isExpanded ? null : feed.id)}
                        className="p-1 rounded text-vault-muted hover:text-vault-text hover:bg-vault-border/40 transition-colors"
                        title="Filter categories"
                      >
                        <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => removeRssFeed(feed.id)}
                      className="p-1 text-vault-muted/50 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Cookie editor */}
                {editCookie?.feedId === feed.id && (
                  <div className="bg-vault-bg/60 border-t border-vault-border/50 p-2 flex flex-col gap-1.5">
                    <span className="text-[10px] text-vault-muted">Paste your browser cookie string:</span>
                    <textarea
                      rows={3}
                      value={editCookie.value}
                      onChange={(e) => setEditCookie({ ...editCookie, value: e.target.value })}
                      placeholder="e.g. tluid=abc123; tlpass=xyz"
                      className="w-full px-2 py-1.5 rounded bg-vault-bg border border-vault-border text-[10px] text-vault-text font-mono focus:outline-none focus:border-vault-teal/50 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { updateRssFeed(feed.id, { cookie: editCookie.value }); setEditCookie(null); fetchFeeds(); }}
                        className="flex-1 py-1 rounded bg-vault-teal/20 text-vault-teal text-[10px] font-semibold hover:bg-vault-teal/30 transition-colors"
                      >
                        Save &amp; Refresh
                      </button>
                      {feed.cookie && (
                        <button
                          onClick={() => { updateRssFeed(feed.id, { cookie: '' }); setEditCookie(null); }}
                          className="py-1 px-2 rounded bg-red-500/10 text-red-400 text-[10px] hover:bg-red-500/20 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Category checklist */}
                {isExpanded && cats.length > 0 && (
                  <div className="bg-vault-bg/60 border-t border-vault-border/50 p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-vault-muted">Categories</span>
                      <div className="flex gap-2">
                        <button onClick={() => setAllCategories(feed.name, true)}  className="text-[10px] text-vault-teal hover:underline">All</button>
                        <button onClick={() => setAllCategories(feed.name, false)} className="text-[10px] text-vault-muted hover:underline">None</button>
                      </div>
                    </div>
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {cats.map((cat) => (
                        <label key={cat} className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={filters[cat] !== false}
                            onChange={() => toggleCategory(feed.name, cat)}
                            className="w-3 h-3 rounded accent-vault-teal cursor-pointer"
                          />
                          <span className="text-[11px] text-vault-text group-hover:text-white transition-colors truncate">{cat}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
