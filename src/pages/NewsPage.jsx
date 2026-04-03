import { useState, useEffect } from 'react';
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
  const { config, addRssFeed, removeRssFeed } = useConfig();
  const [news, setNews] = useState(DEMO_NEWS);
  const [loading, setLoading] = useState(false);
  const [activeSource, setActiveSource] = useState('All');
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [newFeed, setNewFeed] = useState({ name: '', url: '' });
  const [selectedArticle, setSelectedArticle] = useState(null);

  const sources = ['All', ...config.rssFeeds.map((f) => f.name)];

  const filtered = activeSource === 'All'
    ? news
    : news.filter((n) => n.source === activeSource);

  const fetchFeeds = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rss/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: config.rssFeeds.filter((f) => f.enabled) }),
      });
      const data = await res.json();
      if (data.items?.length > 0) setNews(data.items);
    } catch {
      // Keep demo data on failure
    } finally {
      setLoading(false);
    }
  };

  const handleAddFeed = () => {
    if (!newFeed.name || !newFeed.url) return;
    addRssFeed(newFeed);
    setNewFeed({ name: '', url: '' });
    setShowAddFeed(false);
  };

  const handleSendToDownloads = (article) => {
    // In production, this would push to the downloads queue
    console.log('Send to downloads:', article);
  };

  return (
    <div className="flex h-full animate-fade-in">
      {/* Feed list */}
      <div className="flex-1 flex flex-col">
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
          <div className="px-6 py-3 border-b border-vault-border bg-vault-card/30 flex items-center gap-3">
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
            <button onClick={handleAddFeed} className="px-3 py-1.5 rounded-md bg-vault-accent text-white text-xs hover:bg-vault-accentHover">
              Add
            </button>
            <button onClick={() => setShowAddFeed(false)} className="text-vault-muted hover:text-vault-text text-xs">
              Cancel
            </button>
          </div>
        )}

        {/* Articles */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {filtered.map((article) => (
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
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleSendToDownloads(article); }}
                  className="shrink-0 p-2 rounded-lg text-vault-muted hover:text-vault-accent hover:bg-vault-accent/10 transition-colors"
                  title="Send to Downloads"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Managed feeds panel */}
      <div className="w-64 shrink-0 border-l border-vault-border bg-vault-surface/50 flex flex-col">
        <div className="px-4 py-3 border-b border-vault-border">
          <h3 className="text-xs font-bold uppercase tracking-widest text-vault-muted">Managed Feeds</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {config.rssFeeds.map((feed) => (
            <div key={feed.id} className="flex items-center gap-2 p-2 rounded-lg bg-vault-card/50 border border-vault-border">
              <div className={`w-2 h-2 rounded-full ${feed.enabled ? 'bg-green-500' : 'bg-vault-muted/30'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-vault-text truncate">{feed.name}</p>
                <p className="text-[10px] text-vault-muted truncate">{feed.url}</p>
              </div>
              <button
                onClick={() => removeRssFeed(feed.id)}
                className="text-vault-muted/50 hover:text-red-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
