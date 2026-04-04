import { useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import HomePage from '../../pages/HomePage';
import LibraryPage from '../../pages/LibraryPage';
import LiveTVPage from '../../pages/LiveTVPage';
import NewsPage from '../../pages/NewsPage';
import DownloadsPage from '../../pages/DownloadsPage';
import SettingsPage from '../../pages/SettingsPage';

const PAGES = {
  home: HomePage,
  library: LibraryPage,
  livetv: LiveTVPage,
  news: NewsPage,
  downloads: DownloadsPage,
  settings: SettingsPage,
};

export default function MainLayout({ onLogout }) {
  const [section, setSection] = useState('home');
  const [navPayload, setNavPayload] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // onNavigate(section, payload?) — payload is passed to the target page once
  const handleNavigate = (newSection, payload = null) => {
    setSection(newSection);
    setNavPayload(payload);
  };

  const PageComponent = PAGES[section] || HomePage;

  return (
    <div className="flex h-screen overflow-hidden bg-vault-bg animate-fade-in">
      <Sidebar
        section={section}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={onLogout}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          section={section}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <main className="flex-1 overflow-y-auto">
          <PageComponent
            searchQuery={searchQuery}
            onNavigate={handleNavigate}
            navPayload={navPayload}
            onClearNavPayload={() => setNavPayload(null)}
          />
        </main>
      </div>
    </div>
  );
}
