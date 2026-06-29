import { useState } from 'react';

const SECTIONS = [
  { id: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
  { id: 'library', label: 'Library', icon: 'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z' },
  { id: 'livetv', label: 'Live TV', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'news', label: 'News', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { id: 'downloads', label: 'Downloads', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' },
  { id: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

// VOD folder: groups the provider's on-demand catalogue into Movies + Series.
// Both children deep-link into the Live TV page's VOD/Series tabs.
const VOD_GROUP = {
  id: 'vod',
  label: 'VOD',
  icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  children: [
    { id: 'livetv-vod', label: 'Movies', icon: 'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z' },
    { id: 'livetv-series', label: 'Series', icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z' },
  ],
};

// Separate admin section — only shown when user has admin role
const ADMIN_SECTION = { id: 'mission-control', label: 'Mission Control', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z' };

export default function Sidebar({ section, onNavigate, collapsed, onToggleCollapse, onLogout, isAdmin }) {
  // Which VOD child is active (set on click; reset when leaving Live TV).
  const [activeVodChild, setActiveVodChild] = useState(null);
  const vodActive = section === 'livetv' && activeVodChild != null;
  // Auto-expand the group while a child is active; otherwise let the user toggle.
  const [vodExpanded, setVodExpanded] = useState(false);
  const showVodChildren = !collapsed && (vodExpanded || vodActive);

  const goVodChild = (childId) => {
    setActiveVodChild(childId);
    setVodExpanded(true);
    onNavigate(childId);
  };

  // Navigating to any non-Live-TV section clears the VOD child highlight.
  if (section !== 'livetv' && activeVodChild != null) setActiveVodChild(null);

  return (
    <aside
      className={`${collapsed ? 'w-20' : 'w-60'} h-full bg-vault-surface border-r border-vault-border flex flex-col transition-all duration-300 ease-in-out shrink-0`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-vault-border">
        <svg width="32" height="32" viewBox="0 0 64 64" fill="none" className="shrink-0">
          <rect x="4" y="8" width="56" height="48" rx="6" stroke="#e50914" strokeWidth="2.5" fill="none" />
          <path d="M24 22L42 32L24 42V22Z" fill="#e50914" />
        </svg>
        {!collapsed && (
          <span className="font-display text-2xl tracking-wider text-white">
            MEDIA<span className="text-vault-accent">VAULT</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {SECTIONS.map((s) => {
          // 'livetv' is active only when no VOD child is selected, so Live TV and
          // the VOD children don't both highlight (all share section==='livetv').
          const active = section === s.id && !(s.id === 'livetv' && vodActive);
          return (
            <div key={s.id}>
              <button
                onClick={() => {
                  if (s.id === 'livetv') {
                    setActiveVodChild(null); // back to live channels
                    onNavigate('livetv', { _tab: 'live' }); // force the Live tab
                  } else {
                    onNavigate(s.id);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group
                  ${active
                    ? 'bg-vault-accent/15 text-vault-accent'
                    : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                  }`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
                {!collapsed && <span>{s.label}</span>}
                {active && !collapsed && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-vault-accent" />
                )}
              </button>

              {/* ── VOD folder — rendered right below Live TV ──────────────── */}
              {s.id === 'livetv' && (
                <div className="mt-1">
                  <button
                    onClick={() => collapsed ? goVodChild('livetv-vod') : setVodExpanded((v) => !v)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                      ${vodActive
                        ? 'bg-vault-accent/15 text-vault-accent'
                        : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                      }`}
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={VOD_GROUP.icon} />
                    </svg>
                    {!collapsed && (
                      <>
                        <span>{VOD_GROUP.label}</span>
                        <svg className={`w-3.5 h-3.5 ml-auto transition-transform ${showVodChildren ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>

                  {showVodChildren && (
                    <div className="mt-1 ml-4 pl-3 border-l border-vault-border/60 space-y-1">
                      {VOD_GROUP.children.map((c) => {
                        const childActive = vodActive && activeVodChild === c.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => goVodChild(c.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                              ${childActive
                                ? 'bg-vault-accent/15 text-vault-accent'
                                : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                              }`}
                          >
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d={c.icon} />
                            </svg>
                            <span>{c.label}</span>
                            {childActive && (
                              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-vault-accent" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Mission Control — admin only ──────────────────────────────── */}
        {isAdmin && (
          <>
            <div className="my-2 border-t border-vault-border/50" />
            <button
              onClick={() => onNavigate(ADMIN_SECTION.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group
                ${section === ADMIN_SECTION.id
                  ? 'bg-vault-accent/15 text-vault-accent'
                  : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                }`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ADMIN_SECTION.icon} />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {!collapsed && (
                <>
                  <span>{ADMIN_SECTION.label}</span>
                  <svg className="w-3 h-3 ml-auto text-vault-accent/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </>
              )}
            </button>
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="mx-3 mb-4 space-y-1">
        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-vault-muted hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!collapsed && <span>Sign Out</span>}
          </button>
        )}
        <button
          onClick={onToggleCollapse}
          className="w-full py-2 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors flex items-center justify-center"
        >
          <svg className={`w-5 h-5 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
