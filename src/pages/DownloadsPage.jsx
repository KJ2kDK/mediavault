import { useState, useEffect, useRef, useCallback } from 'react';

const STATUS_COLORS = {
  downloading: 'text-vault-teal',
  completed: 'text-green-400',
  seeding: 'text-blue-400',
  queued: 'text-vault-muted',
  paused: 'text-vault-gold',
  error: 'text-red-400',
};

const STATUS_BG = {
  downloading: 'bg-vault-teal/15',
  completed: 'bg-green-400/15',
  seeding: 'bg-blue-400/15',
  queued: 'bg-vault-muted/15',
  paused: 'bg-vault-gold/15',
  error: 'bg-red-400/15',
};

function formatSpeed(bytes) {
  if (!bytes || bytes < 1024) return '0 KB/s';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB/s';
  return (bytes / 1048576).toFixed(1) + ' MB/s';
}

export default function DownloadsPage() {
  const [torrents, setTorrents] = useState([]);
  const [showAddTorrent, setShowAddTorrent] = useState(false);
  const [magnetLink, setMagnetLink] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('added'); // added | name | size | progress | ratio | speed
  const [sortDir, setSortDir] = useState('desc'); // asc | desc
  const [connected, setConnected] = useState(null); // null = checking, true/false
  const [disk, setDisk] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null); // { type: 'error'|'ok', text }
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const fetchTorrents = useCallback(async () => {
    try {
      const res = await fetch('/api/qbit/list');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTorrents(data.torrents || []);
      setConnected(true);
      // Fetch disk info (less often is fine — piggyback on torrent poll)
      try {
        const diskRes = await fetch('/api/qbit/disk');
        if (diskRes.ok) setDisk(await diskRes.json());
      } catch {}
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchTorrents();
    pollRef.current = setInterval(fetchTorrents, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchTorrents]);

  // Distinct qBittorrent categories present in the current list (for the filter).
  const categories = [...new Set(torrents.map((t) => t.category).filter(Boolean))].sort();

  // Multi-criteria filter (status + category + search) then sort.
  const SORT_KEYS = {
    added: (t) => t.rawAddedOn || 0,
    name: (t) => (t.name || '').toLowerCase(),
    size: (t) => t.rawSize || 0,
    progress: (t) => t.rawProgress || 0,
    ratio: (t) => t.ratio || 0,
    speed: (t) => t.rawDlSpeed || 0,
  };
  const visible = torrents
    .filter((t) => filterStatus === 'all' || t.status === filterStatus)
    .filter((t) => filterCategory === 'all' || t.category === filterCategory)
    .filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const keyFn = SORT_KEYS[sortBy] || SORT_KEYS.added;
      const av = keyFn(a), bv = keyFn(b);
      let cmp;
      if (typeof av === 'string') cmp = av.localeCompare(bv);
      else cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const downloading = torrents.filter((t) => t.status === 'downloading').length;
  const completed = torrents.filter((t) => t.progress === 100).length;
  const totalDlSpeed = torrents.reduce((sum, t) => sum + (t.rawDlSpeed || 0), 0);
  const totalUpSpeed = torrents.reduce((sum, t) => sum + (t.rawUpSpeed || 0), 0);

  const handleAddTorrent = async () => {
    if (!magnetLink) return;
    try {
      // No savePath — let qBittorrent use its own configured default save path
      // (mirrors the native Web UI). The old config default '/downloads' doesn't
      // exist on the seedbox and pushed torrents into an error state.
      const res = await fetch('/api/qbit/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: magnetLink }),
      });
      if (res.ok) {
        setMagnetLink('');
        setShowAddTorrent(false);
        fetchTorrents();
      }
    } catch { /* silent */ }
  };

  // Upload a local .torrent file to the seedbox's qBittorrent (mirrors the
  // qBittorrent Web UI's file upload). Sends raw bytes; backend forwards them.
  const uploadTorrentFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith('.torrent'));
    if (files.length === 0) {
      setUploadMsg({ type: 'error', text: 'Please choose a .torrent file' });
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    let added = 0;
    for (const file of files) {
      try {
        // No savepath — qBittorrent uses its own default (mirrors native Web UI).
        const params = new URLSearchParams({ filename: file.name });
        const res = await fetch(`/api/qbit/add-file?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        if (res.ok) added += 1;
        else {
          const data = await res.json().catch(() => ({}));
          setUploadMsg({ type: 'error', text: data.error || `Failed to add ${file.name}` });
        }
      } catch {
        setUploadMsg({ type: 'error', text: `Failed to upload ${file.name}` });
      }
    }
    setUploading(false);
    if (added > 0) {
      setUploadMsg({ type: 'ok', text: `Added ${added} torrent${added > 1 ? 's' : ''}` });
      fetchTorrents();
      setTimeout(() => setUploadMsg(null), 4000);
    }
  };

  const handleFileInput = (e) => {
    uploadTorrentFiles(e.target.files);
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    uploadTorrentFiles(e.dataTransfer.files);
  };

  const handleAction = async (hash, action) => {
    try {
      await fetch(`/api/qbit/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash }),
      });
      fetchTorrents();
    } catch { /* silent */ }
  };

  return (
    <div className="p-6 animate-fade-in">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Downloading', value: downloading, color: 'text-vault-teal', icon: '↓' },
          { label: 'Completed', value: completed, color: 'text-green-400', icon: '✓' },
          { label: 'Download Speed', value: formatSpeed(totalDlSpeed), color: 'text-vault-accent', icon: '⬇' },
          { label: 'Upload Speed', value: formatSpeed(totalUpSpeed), color: 'text-blue-400', icon: '⬆' },
        ].map((stat) => (
          <div key={stat.label} className="p-4 rounded-lg bg-vault-surface border border-vault-border">
            <p className="text-[10px] uppercase tracking-widest text-vault-muted mb-1">{stat.label}</p>
            <p className={`text-2xl font-display tracking-wide ${stat.color}`}>
              <span className="mr-1 text-base">{stat.icon}</span>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Disk usage */}
      {disk && (
        <div className="mb-6 p-4 rounded-lg bg-vault-surface border border-vault-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-vault-muted">Seedbox Storage</span>
            <span className="text-xs text-vault-muted">{disk.used} / {disk.total} ({disk.pct}%)</span>
          </div>
          <div className="h-2 w-full bg-vault-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                disk.pct > 90 ? 'bg-red-500' : disk.pct > 70 ? 'bg-vault-gold' : 'bg-vault-teal'
              }`}
              style={{ width: `${disk.pct}%` }}
            />
          </div>
          <p className="text-[10px] text-vault-muted mt-1">{disk.free} free</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['all', 'downloading', 'completed', 'queued', 'paused'].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                filterStatus === s
                  ? 'bg-vault-accent text-white'
                  : 'bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddTorrent(!showAddTorrent)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover transition-colors shadow-lg shadow-vault-accent/20"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Torrent
        </button>
      </div>

      {/* Filter / sort row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search torrents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
          />
        </div>

        {/* Category filter — only when categories exist */}
        {categories.length > 0 && (
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-text focus:outline-none focus:border-vault-accent/50"
            title="Filter by category"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Sort key */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-text focus:outline-none focus:border-vault-accent/50"
          title="Sort by"
        >
          <option value="added">Date Added</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="progress">Progress</option>
          <option value="ratio">Ratio</option>
          <option value="speed">Download Speed</option>
        </select>

        {/* Sort direction */}
        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          className="px-2.5 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-muted hover:text-vault-text transition-colors"
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
      </div>

      {/* Add torrent form */}
      {showAddTorrent && (
        <div className="mb-4 p-4 rounded-lg bg-vault-card border border-vault-border space-y-3">
          {/* Magnet / URL row */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Paste magnet link or torrent URL..."
              value={magnetLink}
              onChange={(e) => setMagnetLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTorrent(); }}
              className="flex-1 px-3 py-2 rounded-md bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
            />
            <button onClick={handleAddTorrent} className="px-4 py-2 rounded-md bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover">
              Download
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-vault-border" />
            <span className="text-[10px] uppercase tracking-widest text-vault-muted">or upload .torrent</span>
            <div className="flex-1 h-px bg-vault-border" />
          </div>

          {/* Drag-and-drop / file picker */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-md border border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-vault-accent bg-vault-accent/10'
                : 'border-vault-border hover:border-vault-muted bg-vault-bg/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".torrent"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
            {uploading ? (
              <p className="text-xs text-vault-teal">Uploading…</p>
            ) : (
              <>
                <svg className="w-6 h-6 mx-auto mb-1.5 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-xs text-vault-text">Drop .torrent files here or <span className="text-vault-accent">browse</span></p>
                <p className="text-[10px] text-vault-muted mt-0.5">Sent straight to your seedbox</p>
              </>
            )}
          </div>

          {uploadMsg && (
            <p className={`text-xs ${uploadMsg.type === 'error' ? 'text-red-400' : 'text-green-400'}`}>
              {uploadMsg.text}
            </p>
          )}
        </div>
      )}

      {/* Connection status */}
      {connected === null && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-vault-card border border-vault-border flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-vault-teal animate-pulse" />
          <p className="text-xs text-vault-muted">Connecting to qBittorrent...</p>
        </div>
      )}
      {connected === false && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-vault-card border border-vault-border flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <p className="text-xs text-vault-muted">
            Cannot reach qBittorrent — check URL and credentials in <span className="text-vault-teal">Settings</span> or .env file.
          </p>
        </div>
      )}

      {/* Torrent list */}
      {connected && torrents.length === 0 && (
        <div className="text-center text-vault-muted text-sm py-16">
          No torrents. Send one from the News page or click + Add Torrent above.
        </div>
      )}
      {connected && torrents.length > 0 && (
        <p className="text-[10px] text-vault-muted mb-2">
          Showing {visible.length} of {torrents.length} torrents
        </p>
      )}
      <div className="space-y-2">
        {visible.map((torrent) => (
          <div key={torrent.id} className="p-4 rounded-lg bg-vault-surface border border-vault-border hover:border-vault-border/80 transition-colors">
            <div className="flex items-center gap-4">
              {/* Status icon */}
              <div className={`w-9 h-9 rounded-lg ${STATUS_BG[torrent.status] || STATUS_BG.queued} flex items-center justify-center shrink-0`}>
                {torrent.status === 'downloading' ? (
                  <svg className="w-4 h-4 text-vault-teal animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                ) : torrent.status === 'completed' || torrent.status === 'seeding' ? (
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : torrent.status === 'paused' ? (
                  <svg className="w-4 h-4 text-vault-gold" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-vault-text truncate">{torrent.name}</h4>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-vault-muted">{torrent.size}</span>
                  {torrent.status === 'downloading' && (
                    <span className="text-[10px] text-vault-teal">{torrent.speed}</span>
                  )}
                  {(torrent.status === 'seeding' || torrent.status === 'completed') && (
                    <span className={`text-[10px] font-semibold ${torrent.status === 'seeding' ? 'text-green-400' : 'text-red-400'}`}>
                      {torrent.status === 'seeding' ? `↑ ${torrent.upSpeed} · Seeding` : 'Not seeding'}
                    </span>
                  )}
                  {torrent.status !== 'seeding' && torrent.status !== 'completed' && torrent.status !== 'downloading' && (
                    <span className={`text-[10px] ${STATUS_COLORS[torrent.status] || 'text-vault-muted'}`}>{torrent.speed}</span>
                  )}
                  {torrent.status === 'downloading' && <span className="text-[10px] text-vault-muted">ETA: {torrent.eta}</span>}
                  <span className={`text-[10px] ${torrent.ratio >= 1 ? 'text-green-400' : 'text-vault-muted'}`} title="Seed ratio">R:{torrent.ratio?.toFixed(2)}</span>
                  <span className="text-[10px] text-vault-muted">S:{torrent.seeds} P:{torrent.peers}</span>
                  <span className="text-[10px] text-vault-muted">{torrent.added}</span>
                </div>

                {/* Progress bar */}
                {torrent.progress < 100 && (
                  <div className="mt-2 h-1 w-full bg-vault-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-vault-teal to-vault-teal/70"
                      style={{ width: `${torrent.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Progress % */}
              <span className={`text-sm font-mono font-medium ${STATUS_COLORS[torrent.status] || 'text-vault-muted'} shrink-0`}>
                {torrent.progress}%
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {(torrent.status === 'downloading' || torrent.status === 'seeding') && (
                  <button
                    onClick={() => handleAction(torrent.id, 'pause')}
                    className="p-1.5 rounded text-vault-muted hover:text-vault-gold hover:bg-vault-gold/10 transition-colors"
                    title="Pause"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  </button>
                )}
                {torrent.status === 'paused' && (
                  <button
                    onClick={() => handleAction(torrent.id, 'resume')}
                    className="p-1.5 rounded text-vault-muted hover:text-vault-teal hover:bg-vault-teal/10 transition-colors"
                    title="Resume"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => handleAction(torrent.id, 'delete')}
                  className="p-1.5 rounded text-vault-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  title="Remove"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
