import { useState, useEffect, useCallback } from 'react';

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatDate(mtime) {
  if (!mtime) return '';
  try { return new Date(mtime).toLocaleDateString(); } catch { return ''; }
}

export default function FileManagerPage() {
  const [path, setPath] = useState(null); // null = media root
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (targetPath) => {
    setLoading(true);
    setError(null);
    try {
      const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
      const res = await fetch(`/api/files/list${qs}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed to list (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setPath(json.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  const mutate = async (url, body, okMsg) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Request failed (${res.status})`);
      }
      await load(path);
    } catch (e) {
      window.alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (entry) => {
    if (!window.confirm(`Permanently delete "${entry.name}"? This cannot be undone.`)) return;
    mutate('/api/files/delete', { path: entry.path });
  };

  const handleRename = (entry) => {
    const newName = window.prompt('Rename to:', entry.name);
    if (!newName || newName === entry.name) return;
    mutate('/api/files/rename', { path: entry.path, newName });
  };

  const handleMkdir = () => {
    const name = window.prompt('New folder name:');
    if (!name) return;
    mutate('/api/files/mkdir', { path, name });
  };

  const entries = data?.entries || [];

  return (
    <div className="p-6 animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => load(data?.parent ?? null)}
            disabled={data?.atRoot || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Up
          </button>
          <code className="text-xs text-vault-muted truncate max-w-[60vw]" title={path || ''}>
            {path || '…'}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMkdir}
            disabled={busy || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border disabled:opacity-40 transition-colors"
          >
            New folder
          </button>
          <button
            onClick={() => load(path)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border disabled:opacity-40 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Listing */}
      <div className="rounded-xl border border-vault-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 bg-vault-card text-[11px] uppercase tracking-wider text-vault-muted">
          <span>Name</span>
          <span className="text-right w-20">Size</span>
          <span className="text-right w-24">Modified</span>
          <span className="text-right w-28">Actions</span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-vault-muted">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-vault-muted">Empty folder</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.path}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 items-center border-t border-vault-border/50 hover:bg-vault-card/50 transition-colors group"
            >
              <button
                onClick={() => entry.type === 'directory' && load(entry.path)}
                className={`flex items-center gap-2 min-w-0 text-left ${entry.type === 'directory' ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <svg className={`w-4 h-4 shrink-0 ${entry.type === 'directory' ? 'text-vault-gold' : 'text-vault-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {entry.type === 'directory' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" />
                  )}
                </svg>
                <span className="text-sm text-vault-text truncate group-hover:text-white">{entry.name}</span>
              </button>
              <span className="text-xs text-vault-muted text-right w-20">{entry.type === 'file' ? formatSize(entry.size) : '—'}</span>
              <span className="text-xs text-vault-muted text-right w-24">{formatDate(entry.mtime)}</span>
              <div className="flex items-center justify-end gap-2 w-28">
                <button
                  onClick={() => handleRename(entry)}
                  disabled={busy}
                  className="text-xs text-vault-muted hover:text-vault-text disabled:opacity-40 transition-colors"
                  title="Rename"
                >
                  Rename
                </button>
                <button
                  onClick={() => handleDelete(entry)}
                  disabled={busy}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors"
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
