const SECTIONS = [
  { id: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4' },
  { id: 'library', label: 'Library', icon: 'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z' },
  { id: 'livetv', label: 'Live TV', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { id: 'news', label: 'News', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { id: 'downloads', label: 'Downloads', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' },
  { id: 'settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

export default function Sidebar({ section, onNavigate, collapsed, onToggleCollapse }) {
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
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
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
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="mx-3 mb-4 py-2 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors flex items-center justify-center"
      >
        <svg className={`w-5 h-5 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </aside>
  );
}
