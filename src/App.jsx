import { useState, useEffect } from 'react';
import SplashScreen from './components/splash/SplashScreen';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './pages/LoginPage';
import { ConfigProvider } from './hooks/ConfigProvider';

// Wrap global fetch to auto-attach JWT token to API requests
const originalFetch = window.fetch;
window.fetch = function (url, opts = {}) {
  if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    const token = localStorage.getItem('mediavault_token');
    if (token) {
      opts.headers = { ...opts.headers, Authorization: `Bearer ${token}` };
    }
  }
  return originalFetch.call(this, url, opts);
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [authed, setAuthed] = useState(null); // null = checking

  useEffect(() => {
    const token = localStorage.getItem('mediavault_token');
    if (!token) { setAuthed(false); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.ok) setAuthed(true); else { localStorage.removeItem('mediavault_token'); setAuthed(false); } })
      .catch(() => setAuthed(false));
  }, []);

  const handleSplashComplete = () => {
    setSplashFading(true);
    setTimeout(() => setShowSplash(false), 600);
  };

  const handleLogin = (token) => {
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('mediavault_token');
    setAuthed(false);
  };

  if (authed === null) return null; // checking token

  if (!authed) return <LoginPage onLogin={handleLogin} />;

  return (
    <ConfigProvider>
      <div className="noise-overlay min-h-screen bg-vault-bg">
        {showSplash ? (
          <SplashScreen
            onComplete={handleSplashComplete}
            fading={splashFading}
          />
        ) : (
          <MainLayout onLogout={handleLogout} />
        )}
      </div>
    </ConfigProvider>
  );
}
