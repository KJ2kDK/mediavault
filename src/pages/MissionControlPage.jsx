import { useState, useEffect, useCallback } from 'react';
import ArgonPanel from '../components/admin/ArgonPanel';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'vault-teal', icon }) {
  return (
    <div className="bg-vault-surface border border-vault-border rounded-xl p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg bg-${color}/10 flex items-center justify-center shrink-0`}>
        <svg className={`w-5 h-5 text-${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </div>
      <div>
        <p className="text-2xl font-bold text-white leading-tight">{value}</p>
        <p className="text-xs text-vault-muted mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-vault-muted/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-bold uppercase tracking-widest text-vault-muted">{title}</h3>
      {action}
    </div>
  );
}

// ── User Management ──────────────────────────────────────────────────────────
function UserManagement() {
  const [users, setUsers] = useState([]);
  const [views, setViews] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [error, setError] = useState('');
  const [editingViews, setEditingViews] = useState(null); // user id whose perms are open

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.ok) { const data = await res.json(); setUsers(data.users); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    fetch('/api/admin/views').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.views) setViews(d.views); }).catch(() => {});
  }, []);

  // Toggle a single view for a user and persist the new set.
  const toggleView = async (user, viewId) => {
    const current = user.allowedViews || [];
    const next = current.includes(viewId)
      ? current.filter((v) => v !== viewId)
      : [...current, viewId];
    const res = await fetch(`/api/admin/users/${user.id}/views`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ views: next }),
    });
    if (res.ok) loadUsers();
  };

  const createUser = async () => {
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    });
    if (res.ok) {
      setNewUser({ username: '', password: '', role: 'user' });
      setShowAdd(false);
      loadUsers();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed');
    }
  };

  const toggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    const res = await fetch(`/api/admin/users/${user.id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) loadUsers();
  };

  const deleteUser = async (user) => {
    if (!confirm(`Delete user "${user.username}"?`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    if (res.ok) loadUsers();
  };

  return (
    <div>
      <SectionHeader
        title="Users"
        action={
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-[10px] px-2 py-1 rounded bg-vault-teal/20 text-vault-teal hover:bg-vault-teal/30 transition-colors"
          >
            + Add User
          </button>
        }
      />

      {showAdd && (
        <div className="mb-3 p-3 rounded-lg bg-vault-card border border-vault-border space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Username"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              className="flex-1 px-3 py-1.5 rounded bg-vault-surface border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50"
            />
            <input
              type="password"
              placeholder="Password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              className="flex-1 px-3 py-1.5 rounded bg-vault-surface border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              className="px-2 py-1.5 rounded bg-vault-surface border border-vault-border text-xs text-white focus:outline-none"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={createUser} className="px-3 py-1 rounded bg-vault-teal text-black text-xs font-medium hover:bg-vault-teal/80">
              Create
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1 rounded bg-vault-card text-vault-muted text-xs hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-vault-card/50 border border-vault-border/50">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${u.role === 'admin' ? 'bg-vault-accent/20 text-vault-accent' : 'bg-vault-teal/20 text-vault-teal'}`}>
              {u.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium">{u.username}</p>
              <p className="text-[10px] text-vault-muted">
                Created {new Date(u.created_at * 1000).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => toggleRole(u)}
              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                u.role === 'admin'
                  ? 'bg-vault-accent/20 text-vault-accent'
                  : 'bg-vault-muted/20 text-vault-muted hover:text-vault-teal hover:bg-vault-teal/20'
              } transition-colors`}
            >
              {u.role}
            </button>
            {u.role !== 'admin' && (
              <button
                onClick={() => setEditingViews(editingViews === u.id ? null : u.id)}
                className={`text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider transition-colors ${
                  editingViews === u.id ? 'bg-vault-teal/20 text-vault-teal' : 'bg-vault-muted/15 text-vault-muted hover:text-vault-teal'
                }`}
                title="Authorize views"
              >
                Views
              </button>
            )}
            <button
              onClick={() => deleteUser(u)}
              className="p-1 rounded text-vault-muted/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              title="Delete user"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          ))}
        {/* Per-user view authorization panel */}
        {editingViews != null && (() => {
          const u = users.find((x) => x.id === editingViews);
          if (!u || u.role === 'admin') return null;
          return (
            <div key={`perm-${u.id}`} className="px-3 py-3 rounded-lg bg-vault-card border border-vault-teal/30">
              <p className="text-[10px] uppercase tracking-widest text-vault-muted mb-2">
                Authorized views for <span className="text-vault-teal font-bold">{u.username}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {views.map((v) => {
                  const on = (u.allowedViews || []).includes(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleView(u, v.id)}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        on
                          ? 'bg-vault-teal/20 text-vault-teal border-vault-teal/40'
                          : 'bg-vault-surface text-vault-muted border-vault-border hover:text-white'
                      }`}
                    >
                      {on ? '✓ ' : ''}{v.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-vault-muted/60 mt-2">Click to grant or revoke. Changes apply on the user's next page load.</p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Log Viewer ───────────────────────────────────────────────────────────────
function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');

  const loadLogs = useCallback(async () => {
    const q = filter ? `?level=${filter}&limit=50` : '?limit=50';
    const res = await fetch(`/api/admin/logs${q}`);
    if (res.ok) { const data = await res.json(); setLogs(data.logs); }
  }, [filter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const clearLogs = async () => {
    if (!confirm('Clear all logs?')) return;
    await fetch('/api/admin/logs', { method: 'DELETE' });
    loadLogs();
  };

  const levelColor = { error: 'text-red-400 bg-red-400/10', warn: 'text-yellow-400 bg-yellow-400/10', info: 'text-blue-400 bg-blue-400/10' };

  return (
    <div>
      <SectionHeader
        title="System Logs"
        action={
          <div className="flex gap-2">
            {['', 'error', 'warn', 'info'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  filter === f ? 'bg-vault-teal/20 text-vault-teal' : 'text-vault-muted hover:text-white'
                }`}
              >
                {f || 'All'}
              </button>
            ))}
            <button onClick={clearLogs} className="text-[10px] px-2 py-0.5 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              Clear
            </button>
          </div>
        }
      />
      <div className="space-y-1 max-h-64 overflow-y-auto rounded-lg border border-vault-border/50">
        {logs.length === 0 && (
          <p className="text-xs text-vault-muted/50 text-center py-6">No logs</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="px-3 py-2 border-b border-vault-border/30 last:border-0">
            <div className="flex items-center gap-2">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${levelColor[log.level] || ''}`}>
                {log.level}
              </span>
              <span className="text-[10px] text-vault-muted font-mono">{log.source}</span>
              <span className="text-[10px] text-vault-muted/50 ml-auto">
                {new Date(log.created_at * 1000).toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-white/80 mt-1 font-mono break-all">{log.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subtitle Cache ───────────────────────────────────────────────────────────
function SubtitleCache({ cacheCount, cacheSize, onRefresh }) {
  const [entries, setEntries] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const loadEntries = async () => {
    const res = await fetch('/api/admin/subtitle-cache');
    if (res.ok) { const data = await res.json(); setEntries(data.entries); }
  };

  const clearCache = async () => {
    if (!confirm('Clear entire subtitle cache?')) return;
    await fetch('/api/admin/subtitle-cache', { method: 'DELETE' });
    onRefresh();
    setEntries([]);
  };

  return (
    <div>
      <SectionHeader
        title={`Subtitle Cache — ${cacheCount} entries (${formatBytes(cacheSize)})`}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { setExpanded(!expanded); if (!expanded) loadEntries(); }}
              className="text-[10px] px-2 py-0.5 rounded text-vault-muted hover:text-vault-teal transition-colors"
            >
              {expanded ? 'Collapse' : 'Inspect'}
            </button>
            <button onClick={clearCache} className="text-[10px] px-2 py-0.5 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              Purge
            </button>
          </div>
        }
      />
      {expanded && (
        <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-vault-border/50">
          {entries.map((e, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-vault-border/30 last:border-0">
              <span className="text-[10px] text-white/70 font-mono truncate flex-1">{e.key.replace('seedbox:', '')}</span>
              <span className="text-[10px] text-vault-muted shrink-0">{formatBytes(e.size)}</span>
            </div>
          ))}
          {entries.length === 0 && <p className="text-xs text-vault-muted/50 text-center py-4">Cache empty</p>}
        </div>
      )}
    </div>
  );
}

// ── System Panel (the original dashboard content) ───────────────────────────
function SystemPanel({ overview, loadOverview }) {
  const { server, counts, dbSize, subCacheSize } = overview || { server: {}, counts: {}, dbSize: 0, subCacheSize: 0 };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Server Uptime"
          value={formatUptime(server.uptime || 0)}
          sub={`PID ${server.pid} · Node ${server.nodeVersion}`}
          color="vault-teal"
          icon="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
        />
        <StatCard
          label="Memory Usage"
          value={`${server.memoryUsed || 0} MB`}
          sub={`of ${server.memoryTotal ? Math.round(server.memoryTotal / 1024) : '?'} GB total`}
          color="vault-gold"
          icon="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
        <StatCard
          label="Subtitles Cached"
          value={counts.subtitlesCached || 0}
          sub={formatBytes(subCacheSize)}
          color="vault-teal"
          icon="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
        />
        <StatCard
          label="Database Size"
          value={formatBytes(dbSize)}
          sub={`${counts.errors || 0} errors · ${counts.warnings || 0} warnings`}
          color="vault-accent"
          icon="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
        />
      </div>

      <div className="bg-vault-card/30 border border-vault-border rounded-xl p-4">
        <UserManagement />
      </div>

      <div className="bg-vault-card/30 border border-vault-border rounded-xl p-4">
        <SubtitleCache cacheCount={counts.subtitlesCached || 0} cacheSize={subCacheSize} onRefresh={loadOverview} />
      </div>

      <div className="bg-vault-card/30 border border-vault-border rounded-xl p-4">
        <LogViewer />
      </div>

      <div className="text-center text-[10px] text-vault-muted/40 pb-4">
        {server.platform} · Node {server.nodeVersion} · MediaVault v0.1.0
      </div>
    </div>
  );
}

// ── Sub-menu tabs ────────────────────────────────────────────────────────────
const MC_TABS = [
  { id: 'system', label: 'System', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2' },
  { id: 'argon', label: 'Argon Resellers', icon: 'M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z' },
];

// ── Main Mission Control Page ────────────────────────────────────────────────
export default function MissionControlPage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [activeTab, setActiveTab] = useState('system');

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview');
      if (res.status === 403) { setAuthError(true); setLoading(false); return; }
      if (res.ok) { setOverview(await res.json()); }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  if (authError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <svg className="w-16 h-16 text-vault-accent/30 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h2 className="text-xl text-white font-display">Access Denied</h2>
          <p className="text-sm text-vault-muted">Mission Control requires admin privileges.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-vault-accent/30 border-t-vault-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-vault-accent/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-vault-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-wide text-white">Mission Control</h1>
          <p className="text-sm text-vault-muted">System administration &amp; monitoring</p>
        </div>
        <button
          onClick={loadOverview}
          className="ml-auto flex items-center gap-1.5 text-[11px] text-vault-muted hover:text-vault-teal transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Sub-menu tabs */}
      <div className="flex gap-1 border-b border-vault-border">
        {MC_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'text-vault-accent border-vault-accent'
                : 'text-vault-muted border-transparent hover:text-white hover:border-vault-border'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'system' && <SystemPanel overview={overview} loadOverview={loadOverview} />}
      {activeTab === 'argon' && <ArgonPanel />}
    </div>
  );
}
