import { useState, useRef, useEffect } from 'react';
import { useConfig } from '../hooks/useConfig';

const DEMO_CHANNELS = [
  { id: 'c1', name: 'BBC News', group: 'News', logo: null, url: '' },
  { id: 'c2', name: 'CNN International', group: 'News', logo: null, url: '' },
  { id: 'c3', name: 'Al Jazeera', group: 'News', logo: null, url: '' },
  { id: 'c4', name: 'ESPN', group: 'Sports', logo: null, url: '' },
  { id: 'c5', name: 'Sky Sports', group: 'Sports', logo: null, url: '' },
  { id: 'c6', name: 'beIN Sports', group: 'Sports', logo: null, url: '' },
  { id: 'c7', name: 'HBO', group: 'Entertainment', logo: null, url: '' },
  { id: 'c8', name: 'AMC', group: 'Entertainment', logo: null, url: '' },
  { id: 'c9', name: 'Discovery', group: 'Documentary', logo: null, url: '' },
  { id: 'c10', name: 'National Geographic', group: 'Documentary', logo: null, url: '' },
];

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const nameMatch = trimmed.match(/,(.+)$/);
      const groupMatch = trimmed.match(/group-title="([^"]*?)"/);
      const logoMatch = trimmed.match(/tvg-logo="([^"]*?)"/);
      current = {
        id: `m3u_${channels.length}`,
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        logo: logoMatch ? logoMatch[1] : null,
        url: '',
      };
    } else if (trimmed && !trimmed.startsWith('#') && current) {
      current.url = trimmed;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

export default function LiveTVPage() {
  const { config, updateConfig } = useConfig();
  const [channels, setChannels] = useState(DEMO_CHANNELS);
  const [activeChannel, setActiveChannel] = useState(null);
  const [activeGroup, setActiveGroup] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [m3uInput, setM3uInput] = useState('');
  const [xtreamCreds, setXtreamCreds] = useState({
    base: config.iptv.xtreamBase || '',
    user: config.iptv.xtreamUser || '',
    pass: config.iptv.xtreamPass || '',
  });
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const groups = ['All', ...new Set(channels.map((c) => c.group).filter(Boolean))];

  const filtered = channels.filter((c) => {
    const matchGroup = activeGroup === 'All' || c.group === activeGroup;
    const matchSearch = !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchGroup && matchSearch;
  });

  const handleM3UUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseM3U(ev.target.result);
      if (parsed.length > 0) {
        setChannels(parsed);
        updateConfig('iptv', { mode: 'm3u' });
      }
    };
    reader.readAsText(file);
  };

  const handleM3UUrl = async () => {
    if (!m3uInput) return;
    try {
      const res = await fetch(`/api/iptv/m3u?url=${encodeURIComponent(m3uInput)}`);
      const data = await res.json();
      if (data.channels?.length > 0) {
        setChannels(data.channels);
        updateConfig('iptv', { mode: 'm3u', m3uUrl: m3uInput });
      }
    } catch (err) {
      console.error('Failed to fetch M3U:', err);
    }
  };

  const handleXtreamConnect = async () => {
    try {
      const res = await fetch('/api/iptv/xtream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xtreamCreds),
      });
      const data = await res.json();
      if (data.channels?.length > 0) {
        setChannels(data.channels);
        updateConfig('iptv', {
          mode: 'xtream',
          xtreamBase: xtreamCreds.base,
          xtreamUser: xtreamCreds.user,
          xtreamPass: xtreamCreds.pass,
        });
      }
    } catch (err) {
      console.error('Xtream connect failed:', err);
    }
  };

  const playChannel = (channel) => {
    setActiveChannel(channel);
    // In production, initialize HLS.js here with channel.url
  };

  return (
    <div className="flex h-full animate-fade-in">
      {/* Channel sidebar */}
      <div className="w-72 shrink-0 border-r border-vault-border flex flex-col bg-vault-surface/50">
        {/* Search & Setup */}
        <div className="p-3 border-b border-vault-border space-y-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search channels..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-md bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
            />
          </div>
          <button
            onClick={() => setShowSetup(!showSetup)}
            className="w-full text-xs text-vault-teal hover:text-vault-teal/80 flex items-center gap-1 justify-center py-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add IPTV Source
          </button>
        </div>

        {/* Setup panel */}
        {showSetup && (
          <div className="p-3 border-b border-vault-border space-y-3 bg-vault-card/50">
            <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium">M3U Playlist</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="M3U URL..."
                value={m3uInput}
                onChange={(e) => setM3uInput(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
              />
              <button onClick={handleM3UUrl} className="px-2 py-1 rounded-md bg-vault-accent text-white text-xs hover:bg-vault-accentHover">
                Load
              </button>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-1.5 rounded-md border border-dashed border-vault-border text-xs text-vault-muted hover:text-vault-text hover:border-vault-muted transition-colors"
            >
              Upload .m3u file
            </button>
            <input ref={fileInputRef} type="file" accept=".m3u,.m3u8" className="hidden" onChange={handleM3UUpload} />

            <div className="border-t border-vault-border pt-3 mt-2">
              <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium mb-2">Xtream Codes</p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Server URL"
                  value={xtreamCreds.base}
                  onChange={(e) => setXtreamCreds({ ...xtreamCreds, base: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
                />
                <input
                  type="text"
                  placeholder="Username"
                  value={xtreamCreds.user}
                  onChange={(e) => setXtreamCreds({ ...xtreamCreds, user: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={xtreamCreds.pass}
                  onChange={(e) => setXtreamCreds({ ...xtreamCreds, pass: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
                />
                <button onClick={handleXtreamConnect} className="w-full py-1.5 rounded-md bg-vault-teal text-black text-xs font-medium hover:bg-vault-teal/80">
                  Connect
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Group tabs */}
        <div className="flex gap-1 px-3 py-2 overflow-x-auto carousel-row border-b border-vault-border">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                activeGroup === g
                  ? 'bg-vault-accent/20 text-vault-accent'
                  : 'text-vault-muted hover:text-vault-text'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.map((ch) => (
            <button
              key={ch.id}
              onClick={() => playChannel(ch)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                activeChannel?.id === ch.id
                  ? 'bg-vault-accent/10 border-l-2 border-vault-accent'
                  : 'hover:bg-vault-card border-l-2 border-transparent'
              }`}
            >
              <div className="w-8 h-8 rounded bg-vault-card flex items-center justify-center shrink-0">
                {ch.logo ? (
                  <img src={ch.logo} alt="" className="w-6 h-6 object-contain" />
                ) : (
                  <svg className="w-4 h-4 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-vault-text truncate">{ch.name}</p>
                <p className="text-[10px] text-vault-muted">{ch.group}</p>
              </div>
              {activeChannel?.id === ch.id && (
                <div className="ml-auto flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                  <span className="text-[9px] text-red-400 font-bold uppercase">Live</span>
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="px-3 py-2 border-t border-vault-border">
          <p className="text-[10px] text-vault-muted text-center">{channels.length} channels loaded</p>
        </div>
      </div>

      {/* Player area */}
      <div className="flex-1 flex flex-col items-center justify-center bg-black/30 relative">
        {activeChannel ? (
          <div className="w-full h-full flex flex-col">
            {/* Video player */}
            <div className="flex-1 relative bg-black flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-contain" controls />
              {/* Overlay with channel info */}
              <div className="absolute top-4 left-4 glass px-3 py-2 rounded-lg flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
                <span className="text-xs font-medium text-white">{activeChannel.name}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <svg className="w-16 h-16 text-vault-muted/30 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-vault-muted text-sm">Select a channel to start watching</p>
            <p className="text-vault-muted/50 text-xs mt-1">or add an IPTV source from the sidebar</p>
          </div>
        )}
      </div>
    </div>
  );
}
