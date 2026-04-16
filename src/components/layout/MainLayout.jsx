import { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import useWebSocket from '../../hooks/useWebSocket';
import TopBar from './TopBar';
import HomePage from '../../pages/HomePage';
import LibraryPage from '../../pages/LibraryPage';
import LiveTVPage from '../../pages/LiveTVPage';
import NewsPage from '../../pages/NewsPage';
import DownloadsPage from '../../pages/DownloadsPage';
import SettingsPage from '../../pages/SettingsPage';
import MissionControlPage from '../../pages/MissionControlPage';
import ChatPanel from '../chat/ChatPanel';
import VideoPlayer from '../common/VideoPlayer';

const PAGES = {
  home: HomePage,
  library: LibraryPage,
  livetv: LiveTVPage,
  news: NewsPage,
  downloads: DownloadsPage,
  settings: SettingsPage,
  'mission-control': MissionControlPage,
};

export default function MainLayout({ onLogout }) {
  const [section, setSection] = useState('home');
  const [navPayload, setNavPayload] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [remotePlayItem, setRemotePlayItem] = useState(null);

  // Fetch user role on mount (must manually attach token — global wrapper skips /api/auth/)
  useEffect(() => {
    const token = localStorage.getItem('mediavault_token');
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.role) setUserRole(data.role); })
      .catch(() => {});
  }, []);

  // onNavigate(section, payload?) — payload is passed to the target page once.
  const handleNavigate = (newSection, payload = null) => {
    let resolved = newSection;
    let p = payload;
    if (newSection === 'livetv-vod') { resolved = 'livetv'; p = { ...(payload || {}), _tab: 'vod' }; }
    else if (newSection === 'livetv-series') { resolved = 'livetv'; p = { ...(payload || {}), _tab: 'series' }; }
    setSection(resolved);
    setNavPayload(p);
  };

  // WebSocket: receive remote play commands from Telegram bot
  const handleWsPlay = useCallback((msg) => {
    // Play seedbox media in a floating overlay
    setRemotePlayItem({
      id: msg.itemId,
      title: msg.title || 'Remote Play',
      backend: 'seedbox',
      resumeAt: msg.resumeAt || 0,
    });
  }, []);

  const handleWsPlayChannel = useCallback((msg) => {
    // Play live TV channel — navigate to LiveTV page
    handleNavigate('livetv', { autoPlayChannel: msg.channelId, streamUrl: msg.streamUrl, name: msg.name });
  }, []);

  const handleWsNotify = useCallback((text) => {
    console.log('[ws] notification:', text);
  }, []);

  useWebSocket({
    onPlay: handleWsPlay,
    onPlayChannel: handleWsPlayChannel,
    onNavigate: handleNavigate,
    onNotify: handleWsNotify,
  });

  const PageComponent = PAGES[section] || HomePage;

  return (
    <div className="flex h-screen overflow-hidden bg-vault-bg animate-fade-in">
      <Sidebar
        section={section}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={onLogout}
        isAdmin={userRole === 'admin'}
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
      <ChatPanel onNavigate={handleNavigate} onPlay={(action) => {
        if (action.type === 'play') {
          setRemotePlayItem({ id: action.itemId, title: action.title || 'Playing', backend: 'seedbox', resumeAt: action.resumeAt || 0 });
        } else if (action.type === 'play-channel') {
          handleNavigate('livetv', { autoPlayChannel: action.channelId, streamUrl: action.streamUrl, name: action.name });
        }
      }} />
      {remotePlayItem && (
        <VideoPlayer item={remotePlayItem} onClose={() => setRemotePlayItem(null)} />
      )}
    </div>
  );
}
