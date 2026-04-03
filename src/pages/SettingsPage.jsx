import { useState } from 'react';
import { useConfig } from '../hooks/useConfig';

export default function SettingsPage() {
  const { config, updateConfig } = useConfig();
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});

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
