import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from '../hooks/useConfig';
import { fetchLogs, fetchLogStats, clearLogs } from '../hooks/useErrorLog';
import { setChannelCache } from '../hooks/useChannels';
import { clearNowCache } from '../hooks/useEpg';

export default function SettingsPage() {
  const { config, updateConfig } = useConfig();
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

  // ── EPG Sources state ──────────────────────────────────────────────────────
  const [suppJob, setSuppJob]       = useState(null);
  const [newEpgUrl, setNewEpgUrl]   = useState('');
  const suppPollRef                 = useRef(null);

  const fetchSuppStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/epg/supp/status');
      const d = await r.json();
      setSuppJob(d.job);
      if (d.job?.status === 'running') {
        suppPollRef.current = setTimeout(fetchSuppStatus, 2000);
      } else if (d.job?.status === 'done') {
        // Auto-run channel EPG matching after supplemental fetch completes
        fetch('/api/iptv/epg-match', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(r2 => r2.json())
          .then(async (m) => {
            setSuppJob(prev => ({ ...prev, matchedChannels: m.matched }));
            // Refresh channel cache so new epg_ids are live without page reload
            const preload = await fetch('/api/iptv/preload').then(r3 => r3.json());
            if (preload.channels?.length > 0) {
              setChannelCache(preload.channels);
              clearNowCache();
            }
          })
          .catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  const fetchSupplementalEpg = useCallback(async (url) => {
    if (!url?.trim()) return;
    const r = await fetch('/api/epg/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
    const d = await r.json();
    setSuppJob(d);
    if (d.status === 'started' || d.status === 'running') {
      clearTimeout(suppPollRef.current);
      suppPollRef.current = setTimeout(fetchSuppStatus, 2000);
    }
  }, [fetchSuppStatus]);

  const addSuppUrl = (url) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const existing = config.iptv.supplementalEpgUrls ?? [];
    if (!existing.includes(trimmed)) {
      updateConfig('iptv', { supplementalEpgUrls: [...existing, trimmed] });
    }
    setNewEpgUrl('');
  };

  const removeSuppUrl = (url) => {
    updateConfig('iptv', {
      supplementalEpgUrls: (config.iptv.supplementalEpgUrls ?? []).filter((u) => u !== url),
    });
  };

  // ── System Logs state ───────────────────────────────────────────────────────
  const [logs, setLogs] = useState([]);
  const [logStats, setLogStats] = useState({ error: 0, warn: 0, info: 0 });
  const [logLevel, setLogLevel] = useState('all');
  const [logLoading, setLogLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState(null);
  const [logTotal, setLogTotal] = useState(0);

  const loadLogs = useCallback(async (level) => {
    setLogLoading(true);
    try {
      const [logsData, statsData] = await Promise.all([
        fetchLogs({ limit: 300, level: level === 'all' ? undefined : level }),
        fetchLogStats(),
      ]);
      setLogs(logsData.logs ?? []);
      setLogTotal(logsData.total ?? 0);
      setLogStats(statsData);
    } catch {
      // ignore
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(logLevel); }, [logLevel, loadLogs]);

  const handleClearLogs = async () => {
    await clearLogs();
    setLogs([]);
    setLogStats({ error: 0, warn: 0, info: 0 });
    setLogTotal(0);
  };

  const testConnection = async (service) => {
    setTesting((p) => ({ ...p, [service]: true }));
    setTestResults((p) => ({ ...p, [service]: null }));

    try {
      const res = await fetch(`/api/${service}/test`);
      const data = await res.json();
      setTestResults((p) => ({ ...p, [service]: data.success ? 'connected' : 'failed' }));
      if (data.success) {
        updateConfig(service, { connected: true });
      }
    } catch {
      setTestResults((p) => ({ ...p, [service]: 'failed' }));
    } finally {
      setTesting((p) => ({ ...p, [service]: false }));
    }
  };

  const InputField = ({ label, value, onChange, type = 'text', placeholder }) => (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-vault-muted mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/40 focus:outline-none focus:border-vault-accent/50 focus:ring-1 focus:ring-vault-accent/20 transition-all"
      />
    </div>
  );

  const StatusBadge = ({ service }) => {
    const status = testResults[service];
    if (testing[service]) return <span className="text-[10px] text-vault-gold animate-pulse">Testing...</span>;
    if (status === 'connected') return <span className="text-[10px] text-green-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Connected</span>;
    if (status === 'failed') return <span className="text-[10px] text-red-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Failed</span>;
    return null;
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 animate-fade-in">
      <div>
        <h2 className="font-display text-3xl tracking-wide text-white mb-1">Settings</h2>
        <p className="text-sm text-vault-muted">Configure your media services and connections.</p>
      </div>

      {/* Plex */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#e5a00d]/15 flex items-center justify-center">
              <span className="font-display text-lg text-[#e5a00d]">P</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-vault-text">Plex Media Server</h3>
              <p className="text-[10px] text-vault-muted">Stream your library</p>
            </div>
          </div>
          <StatusBadge service="plex" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <InputField
            label="Server URL"
            value={config.plex.serverUrl}
            onChange={(v) => updateConfig('plex', { serverUrl: v })}
            placeholder="http://localhost:32400"
          />
          <InputField
            label="Auth Token"
            value={config.plex.token}
            onChange={(v) => updateConfig('plex', { token: v })}
            type="password"
            placeholder="Your Plex token"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => testConnection('plex')}
            className="px-4 py-2 rounded-lg bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover transition-colors"
          >
            Test Connection
          </button>
          <a
            href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-vault-teal hover:underline"
          >
            How to find your Plex token →
          </a>
        </div>
      </section>

      {/* qBittorrent */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <span className="font-display text-lg text-blue-400">qB</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-vault-text">qBittorrent</h3>
              <p className="text-[10px] text-vault-muted">Torrent client (Web UI)</p>
            </div>
          </div>
          <StatusBadge service="qbittorrent" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <InputField
            label="Web UI URL"
            value={config.qbittorrent.url}
            onChange={(v) => updateConfig('qbittorrent', { url: v })}
            placeholder="http://localhost:8080"
          />
          <InputField
            label="Save Path"
            value={config.qbittorrent.savePath}
            onChange={(v) => updateConfig('qbittorrent', { savePath: v })}
            placeholder="/downloads"
          />
          <InputField
            label="Username"
            value={config.qbittorrent.username}
            onChange={(v) => updateConfig('qbittorrent', { username: v })}
            placeholder="admin"
          />
          <InputField
            label="Password"
            value={config.qbittorrent.password}
            onChange={(v) => updateConfig('qbittorrent', { password: v })}
            type="password"
            placeholder="Password"
          />
        </div>
        <button
          onClick={() => testConnection('qbittorrent')}
          className="px-4 py-2 rounded-lg bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover transition-colors"
        >
          Test Connection
        </button>
      </section>

      {/* RSS Feeds */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 19.5v-.75a7.5 7.5 0 00-7.5-7.5H4.5m0-6.75h.75c7.87 0 14.25 6.38 14.25 14.25v.75M6 18.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-vault-text">RSS Feeds</h3>
            <p className="text-[10px] text-vault-muted">{config.rssFeeds.length} feeds configured</p>
          </div>
        </div>
        <div className="space-y-2">
          {config.rssFeeds.map((feed) => (
            <div key={feed.id} className="flex items-center gap-3 p-3 rounded-lg bg-vault-card border border-vault-border">
              <div className={`w-2 h-2 rounded-full ${feed.enabled ? 'bg-green-400' : 'bg-vault-muted/30'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-vault-text">{feed.name}</p>
                <p className="text-[10px] text-vault-muted truncate">{feed.url}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-vault-muted mt-3">Manage feeds from the News section.</p>
      </section>

      {/* Channel Manager */}
      {(config.iptv.allGroups?.length > 0 || config.iptv.allVodGenres?.length > 0) && (
        <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-vault-teal/15 flex items-center justify-center">
              <svg className="w-5 h-5 text-vault-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-vault-text">Channel Manager</h3>
              <p className="text-[10px] text-vault-muted">
                {config.iptv.allGroups?.length ?? 0} groups · {config.iptv.allVodGenres?.length ?? 0} VOD genres
              </p>
            </div>
          </div>
          <p className="text-[10px] text-vault-muted mb-4 ml-13">
            Hidden groups are excluded from Live TV and VOD tabs.
          </p>

          {/* Live TV Groups */}
          {config.iptv.allGroups?.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium">Live TV Groups</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateConfig('iptv', { hiddenGroups: [] })}
                    className="text-[10px] text-vault-teal hover:underline"
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => updateConfig('iptv', { hiddenGroups: [...config.iptv.allGroups] })}
                    className="text-[10px] text-vault-muted hover:text-vault-text"
                  >
                    Hide all
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {config.iptv.allGroups.map((group) => {
                  const hidden = config.iptv.hiddenGroups?.includes(group);
                  return (
                    <div
                      key={group}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-vault-card border border-vault-border hover:border-vault-border/80 transition-colors"
                    >
                      <span className={`text-xs truncate flex-1 ${hidden ? 'text-vault-muted/40 line-through' : 'text-vault-text'}`}>
                        {group}
                      </span>
                      <button
                        onClick={() => {
                          const current = config.iptv.hiddenGroups ?? [];
                          const next = hidden
                            ? current.filter((g) => g !== group)
                            : [...current, group];
                          updateConfig('iptv', { hiddenGroups: next });
                        }}
                        className={`ml-3 shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                          hidden ? 'bg-vault-border' : 'bg-vault-teal'
                        }`}
                        title={hidden ? 'Show group' : 'Hide group'}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${hidden ? 'left-0.5' : 'left-4'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VOD Genres */}
          {config.iptv.allVodGenres?.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium">VOD / Series Genres</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateConfig('iptv', { hiddenVodGenres: [] })}
                    className="text-[10px] text-vault-teal hover:underline"
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => updateConfig('iptv', { hiddenVodGenres: [...config.iptv.allVodGenres] })}
                    className="text-[10px] text-vault-muted hover:text-vault-text"
                  >
                    Hide all
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {config.iptv.allVodGenres.map((genre) => {
                  const hidden = config.iptv.hiddenVodGenres?.includes(genre);
                  return (
                    <div
                      key={genre}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-vault-card border border-vault-border"
                    >
                      <span className={`text-xs truncate flex-1 ${hidden ? 'text-vault-muted/40 line-through' : 'text-vault-text'}`}>
                        {genre}
                      </span>
                      <button
                        onClick={() => {
                          const current = config.iptv.hiddenVodGenres ?? [];
                          const next = hidden
                            ? current.filter((g) => g !== genre)
                            : [...current, genre];
                          updateConfig('iptv', { hiddenVodGenres: next });
                        }}
                        className={`ml-3 shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                          hidden ? 'bg-vault-border' : 'bg-vault-teal'
                        }`}
                        title={hidden ? 'Show genre' : 'Hide genre'}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${hidden ? 'left-0.5' : 'left-4'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* EPG Sources */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-vault-text">EPG Sources</h3>
            <p className="text-[10px] text-vault-muted">
              Supplemental XMLTV guides merged on top of your Xtream EPG
            </p>
          </div>
        </div>

        <p className="text-[10px] text-vault-muted mb-3">
          Data is merged on top of your Xtream EPG — covers channels missing from your provider.
        </p>

        {/* Danish quick-add */}
        <div className="mb-4 p-3 rounded-lg bg-vault-card border border-vault-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-vault-text">Danish EPG — epgshare01</p>
              <p className="text-[10px] text-vault-muted mt-0.5">
                BBC Earth, TV2 Echo, TV2 Syd, Disney Jr, Matkanalen &amp; more (updated daily)
              </p>
            </div>
            <button
              onClick={() => {
                const url = 'https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz';
                addSuppUrl(url);
                fetchSupplementalEpg(url);
              }}
              disabled={suppJob?.status === 'running'}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
            >
              {(config.iptv.supplementalEpgUrls ?? []).includes('https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz')
                ? 'Re-fetch'
                : 'Add & Fetch'}
            </button>
          </div>
        </div>

        {/* Saved supplemental sources */}
        {(config.iptv.supplementalEpgUrls ?? []).length > 0 && (
          <div className="space-y-1 mb-3">
            {config.iptv.supplementalEpgUrls.map((url) => (
              <div key={url} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-vault-card border border-vault-border">
                <span className="flex-1 text-[10px] text-vault-muted truncate">{url}</span>
                <button
                  onClick={() => fetchSupplementalEpg(url)}
                  disabled={suppJob?.status === 'running'}
                  className="text-[10px] text-vault-teal hover:underline disabled:opacity-40"
                >
                  Fetch
                </button>
                <button
                  onClick={() => removeSuppUrl(url)}
                  className="text-[10px] text-red-400/60 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Fetch status */}
        {suppJob && (
          <p className={`text-[10px] mb-3 ${
            suppJob.status === 'running' ? 'text-vault-gold animate-pulse'
            : suppJob.status === 'done'  ? 'text-green-400'
            : 'text-red-400'
          }`}>
            {suppJob.status === 'running' && 'Fetching EPG data…'}
            {suppJob.status === 'done' && `Done — ${suppJob.count?.toLocaleString()} programmes merged${suppJob.matchedChannels != null ? `, ${suppJob.matchedChannels} channels matched` : ''}`}
            {suppJob.status === 'error' && `Error: ${suppJob.error}`}
          </p>
        )}

        {/* Add custom URL */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newEpgUrl}
            onChange={(e) => setNewEpgUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addSuppUrl(newEpgUrl); }}
            placeholder="https://example.com/epg.xml"
            className="flex-1 px-3 py-2 rounded-lg bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/40 focus:outline-none focus:border-vault-accent/50 transition-all"
          />
          <button
            onClick={() => { addSuppUrl(newEpgUrl); fetchSupplementalEpg(newEpgUrl); }}
            disabled={!newEpgUrl.trim() || suppJob?.status === 'running'}
            className="px-4 py-2 rounded-lg bg-vault-accent text-white text-xs font-medium hover:bg-vault-accentHover transition-colors disabled:opacity-40"
          >
            Add & Fetch
          </button>
        </div>
      </section>

      {/* System Logs */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-vault-text">System Logs</h3>
              <p className="text-[10px] text-vault-muted">
                {logTotal} total entries &mdash;
                <span className="text-red-400 ml-1">{logStats.error} errors</span>
                <span className="text-yellow-400 mx-1">{logStats.warn} warnings</span>
                <span className="text-blue-400">{logStats.info} info</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadLogs(logLevel)} className="p-1.5 rounded-lg hover:bg-vault-card text-vault-muted hover:text-vault-text transition-colors" title="Refresh">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
            <button
              onClick={handleClearLogs}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Level filter */}
        <div className="flex gap-1 mb-3">
          {['all', 'error', 'warn', 'info'].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLogLevel(lvl)}
              className={`px-3 py-1 rounded-md text-[10px] font-medium uppercase tracking-wide transition-colors ${
                logLevel === lvl
                  ? lvl === 'error' ? 'bg-red-500/20 text-red-400'
                  : lvl === 'warn'  ? 'bg-yellow-500/20 text-yellow-400'
                  : lvl === 'info'  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-vault-accent/20 text-vault-accent'
                  : 'bg-vault-card text-vault-muted hover:text-vault-text'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* Log entries */}
        <div className="space-y-1 max-h-96 overflow-y-auto pr-1 font-mono text-[11px]">
          {logLoading && (
            <p className="text-vault-muted text-center py-4">Loading...</p>
          )}
          {!logLoading && logs.length === 0 && (
            <p className="text-vault-muted text-center py-8">No log entries</p>
          )}
          {!logLoading && logs.map((log) => {
            const isExpanded = expandedLog === log.id;
            const levelColor = log.level === 'error' ? 'text-red-400 bg-red-500/10'
              : log.level === 'warn' ? 'text-yellow-400 bg-yellow-500/10'
              : 'text-blue-400 bg-blue-500/10';
            const ts = new Date(log.created_at * 1000).toLocaleString([], {
              month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
            return (
              <div
                key={log.id}
                className="rounded-lg bg-vault-card border border-vault-border overflow-hidden"
              >
                <button
                  className="w-full flex items-start gap-2 p-2 text-left hover:bg-vault-border/10 transition-colors"
                  onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                >
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${levelColor}`}>
                    {log.level}
                  </span>
                  <span className="text-vault-muted shrink-0">{ts}</span>
                  <span className="text-vault-accent shrink-0 max-w-[100px] truncate">[{log.source}]</span>
                  <span className="text-vault-text flex-1 truncate">{log.message}</span>
                  {(log.stack || log.context) && (
                    <svg className={`w-3 h-3 shrink-0 text-vault-muted mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-vault-border">
                    {log.context && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-vault-muted mt-2 mb-1">Context</p>
                        <pre className="text-[10px] text-vault-text bg-vault-bg rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                          {(() => { try { return JSON.stringify(JSON.parse(log.context), null, 2); } catch { return log.context; } })()}
                        </pre>
                      </div>
                    )}
                    {log.stack && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-vault-muted mt-2 mb-1">Stack trace</p>
                        <pre className="text-[10px] text-red-300/80 bg-vault-bg rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                          {log.stack}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* About */}
      <section className="p-5 rounded-xl bg-vault-surface border border-vault-border">
        <h3 className="text-sm font-semibold text-vault-text mb-2">About MediaVault</h3>
        <p className="text-xs text-vault-muted leading-relaxed">
          MediaVault v0.1.0 — Your unified media hub. Connect Plex for library browsing, load IPTV
          channels via M3U or Xtream Codes, track news with RSS feeds, and manage downloads through
          qBittorrent. All in one sleek interface.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <a href="https://github.com/yourusername/mediavault" target="_blank" rel="noreferrer" className="text-[10px] text-vault-teal hover:underline">
            GitHub Repository →
          </a>
        </div>
      </section>
    </div>
  );
}
