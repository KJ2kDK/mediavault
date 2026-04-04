import { useState, useEffect } from 'react';
import SplashScreen from './components/splash/SplashScreen';
import MainLayout from './components/layout/MainLayout';
import { ConfigProvider } from './hooks/ConfigProvider';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

  const handleSplashComplete = () => {
    setSplashFading(true);
    setTimeout(() => setShowSplash(false), 600);
  };

  return (
    <ConfigProvider>
      <div className="noise-overlay min-h-screen bg-vault-bg">
        {showSplash ? (
          <SplashScreen
            onComplete={handleSplashComplete}
            fading={splashFading}
          />
        ) : (
          <MainLayout />
        )}
      </div>
    </ConfigProvider>
  );
}
