const SECTION_LABELS = {
  home: 'Home',
  library: 'WhutBux?',
  livetv: 'Live TV',
  news: 'News',
  downloads: 'Downloads',
  settings: 'Settings',
  'mission-control': 'Mission Control',
  'file-manager': 'File Manager',
};

export default function TopBar({ section, searchQuery, onSearchChange }) {
  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-vault-border bg-vault-surface/50 backdrop-blur-md">
      <h2 className="font-display text-2xl tracking-wide text-white">
        {SECTION_LABELS[section]}
      </h2>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search everything..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-64 pl-10 pr-4 py-2 rounded-lg bg-vault-card border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50 focus:ring-1 focus:ring-vault-accent/30 transition-all"
          />
        </div>

        {/* Notification bell */}
        <button className="relative p-2 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-vault-accent" />
        </button>

        {/* Profile */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-vault-accent to-vault-gold flex items-center justify-center text-white text-xs font-bold">
          MV
        </div>
      </div>
    </header>
  );
}
