import { useState, useEffect, useCallback } from 'react';
import { useConfig } from '../hooks/useConfig';

const DEMO_TORRENTS = [
  { id: 't1', name: 'ubuntu-24.04-desktop-amd64.iso', size: '4.7 GB', progress: 100, status: 'completed', speed: '0 KB/s', eta: 'Done', seeds: 142, peers: 3, added: '2h ago' },
  { id: 't2', name: 'libreoffice-24.2.5.iso', size: '2.1 GB', progress: 73, status: 'downloading', speed: '12.4 MB/s', eta: '3m', seeds: 89, peers: 15, added: '15m ago' },
  { id: 't3', name: 'fedora-40-workstation.iso', size: '1.9 GB', progress: 45, status: 'downloading', speed: '8.2 MB/s', eta: '8m', seeds: 64, peers: 22, added: '30m ago' },
  { id: 't4', name: 'debian-12.5-amd64-netinst.iso', size: '628 MB', progress: 12, status: 'downloading', speed: '3.1 MB/s', eta: '2m', seeds: 201, peers: 8, added: '5m ago' },
  { id: 't5', name: 'archlinux-2024.03.01-x86_64.iso', size: '1.1 GB', progress: 0, status: 'queued', speed: '0 KB/s', eta: '—', seeds: 0, peers: 0, added: 'Just now' },
];

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

export default function DownloadsPage() {
  const { config } = useConfig();
  const [torrents, setTorrents] = useState(DEMO_TORRENTS);
  const [showAddTorrent, setShowAddTorrent] = useState(false);
  const [magnetLink, setMagnetLink] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [connected, setConnected] = useState(false);

  const filtered = filterStatus === 'all'
    ? torrents
    : torrents.filter((t) => t.status === filterStatus);

  const stats = {
    downloading: torrents.filter((t) => t.status === 'downloading').length,
    completed: torrents.filter((t) => t.status === 'completed').length,
    totalDown: '23.7 MB/s',
    totalUp: '4.2 MB/s',
  };

  const handleAddTorrent = async () => {
    if (!magnetLink) return;
    try {
      const res = await fetch('/api/qbit/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: magnetLink, savePath: config.qbittorrent.savePath }),
      });
      if (res.ok) {
        setMagnetLink('');
        setShowAddTorrent(false);
      }
    } catch (err) {
      console.error('Failed to add torrent:', err);
    }
  };

  const handleAction = async (torrentId, action) => {
    // In production: POST /api/qbit/{action} with torrent hash
    setTorrents((prev) =>
      prev.map((t) => {
        if (t.id !== torrentId) return t;
        if (action === 'pause') return { ...t, status: 'paused', speed: '0 KB/s' };
        if (action === 'resume') return { ...t, status: 'downloading' };
        if (action === 'delete') return null;
        return t;
      }).filter(Boolean)
    );
  };

  return (
    <div className="p-6 animate-fade-in">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Downloading', value: stats.downloading, color: 'text-vault-teal', icon: '↓' },
          { label: 'Completed', value: stats.completed, color: 'text-green-400', icon: '✓' },
          { label: 'Download Speed', value: stats.totalDown, color: 'text-vault-accent', icon: '⬇' },
          { label: 'Upload Speed', value: stats.totalUp, color: 'text-blue-400', icon: '⬆' },
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

      {/* Add torrent form */}
      {showAddTorrent && (
        <div className="mb-4 p-4 rounded-lg bg-vault-card border border-vault-border flex items-center gap-3">
          <input
            type="text"
            placeholder="Paste magnet link or torrent URL..."
            value={magnetLink}
            onChange={(e) => setMagnetLink(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
          />
          <button onClick={handleAddTorrent} className="px-4 py-2 rounded-md bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover">
            Download
          </button>
        </div>
      )}

      {/* Connection warning */}
      {!connected && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-vault-card border border-vault-border flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-vault-gold animate-pulse" />
          <p className="text-xs text-vault-muted">
            Demo mode — configure qBittorrent connection in <span className="text-vault-teal">Settings</span> to manage real downloads.
          </p>
        </div>
      )}

      {/* Torrent list */}
      <div className="space-y-2">
        {filtered.map((torrent) => (
          <div key={torrent.id} className="p-4 rounded-lg bg-vault-surface border border-vault-border hover:border-vault-border/80 transition-colors">
            <div className="flex items-center gap-4">
              {/* Status icon */}
              <div className={`w-9 h-9 rounded-lg ${STATUS_BG[torrent.status]} flex items-center justify-center shrink-0`}>
                {torrent.status === 'downloading' ? (
                  <svg className="w-4 h-4 text-vault-teal animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                ) : torrent.status === 'completed' ? (
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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
                  <span className={`text-[10px] ${STATUS_COLORS[torrent.status]}`}>{torrent.speed}</span>
                  <span className="text-[10px] text-vault-muted">ETA: {torrent.eta}</span>
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
              <span className={`text-sm font-mono font-medium ${STATUS_COLORS[torrent.status]} shrink-0`}>
                {torrent.progress}%
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {torrent.status === 'downloading' && (
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
