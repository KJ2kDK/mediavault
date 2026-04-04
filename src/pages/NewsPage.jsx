import { useState, useEffect, useMemo, useRef } from 'react';
import { useConfig } from '../hooks/useConfig';

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

export default function NewsPage() {
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
  const searchTimer = useRef(null);
  const refreshTimer = useRef(null);

  const sources = ['All', ...config.rssFeeds.map((f) => f.name)];

  // Auto-fetch whenever the feeds list changes (including on mount)
  useEffect(() => {
    const enabled = config.rssFeeds.filter((f) => f.enabled);
    if (enabled.length > 0) fetchFeeds();
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

  const fetchFeeds = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rss/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: config.rssFeeds.filter((f) => f.enabled) }),
      });
      const data = await res.json();
      // Store per-feed errors
      if (data.errors?.length) {
        const errMap = {};
        for (const e of data.errors) errMap[e.name] = e.error;
        setFeedErrors(errMap);
      } else {
        setFeedErrors({});
      }

      if (data.items?.length > 0) {
        // Extract unique categories per feed (use all categories array from server)
        const catMap = {};
        for (const item of data.items) {
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
        // Enable new categories by default
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
        setNews(data.items);
        // Restore sent markers from server response
        const sent = {};
        for (const it of data.items) if (it.sentAt) sent[it.id] = true;
        setSentIds((prev) => ({ ...prev, ...sent }));
      }
    } catch {
      // Keep demo data on failure
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
          <div className="flex gap-2 overflow-x-auto carousel-row">
            {sources.map((s) => (
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
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search history..."
                className="pl-7 pr-3 py-1.5 rounded-lg bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50 w-44"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-text">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <button
              onClick={fetchFeeds}
              className="p-2 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors"
              title="Refresh feeds"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
            <button
              onClick={() => setShowAddFeed(!showAddFeed)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-vault-teal/15 text-vault-teal hover:bg-vault-teal/25 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Feed
            </button>
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

        {/* Articles */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
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
                  {article.snippet && (
                    <p className="text-xs text-vault-muted mt-1 line-clamp-2">{article.snippet}</p>
                  )}
                  {selectedArticle?.id === article.id && article.link && (
                    <a
                      href={article.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-block mt-2 text-[10px] text-vault-teal hover:underline"
                    >
                      Open article →
                    </a>
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
        </div>
      </div>

      {/* Managed feeds + category filter panel */}
      <div className="w-64 shrink-0 border-l border-vault-border bg-vault-surface/50 flex flex-col">
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
      </div>
    </div>
  );
}
