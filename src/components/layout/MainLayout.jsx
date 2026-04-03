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

export default function MainLayout() {
  const [section, setSection] = useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const PageComponent = PAGES[section] || HomePage;

  return (
    <div className="flex h-screen overflow-hidden bg-vault-bg animate-fade-in">
      <Sidebar
        section={section}
        onNavigate={setSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar
          section={section}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <main className="flex-1 overflow-y-auto">
          <PageComponent searchQuery={searchQuery} />
        </main>
      </div>
    </div>
  );
}
