import { useState, useEffect, useRef, useCallback } from 'react';

export default function PlexPlayer({ item, onClose }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playInfo, setPlayInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSub, setActiveSub] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef(null);

  // Fetch playback info
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/plex/play/${item.id}?server=${encodeURIComponent(item.serverUrl)}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setPlayInfo(data);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [item.id, item.serverUrl]);

  // Start playback once we have play info
  useEffect(() => {
    if (!playInfo || !videoRef.current) return;
    const video = videoRef.current;

    if (!playInfo.streamUrl) { setError('No playback URL'); return; }

    video.src = playInfo.streamUrl;
    video.addEventListener('canplay', () => setLoading(false), { once: true });
    video.addEventListener('error', () => setError('Playback failed — format may not be supported by browser'), { once: true });
    video.play().catch(() => {});
  }, [playInfo]);

  // Escape key closes
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Auto-hide controls
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    showControlsTemporarily();
    return () => clearTimeout(hideTimer.current);
  }, [showControlsTemporarily]);

  const formatTime = (ms) => {
    const totalSec = Math.floor((ms || 0) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  const title = playInfo?.showTitle
    ? `${playInfo.showTitle} — ${playInfo.episode} — ${playInfo.title}`
    : playInfo?.title || item.title;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onMouseMove={showControlsTemporarily}
      onClick={showControlsTemporarily}
    >
      {/* Top bar */}
      <div className={`absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-white text-sm font-medium truncate flex-1">{title}</h2>
          {/* Subtitle selector */}
          {playInfo?.subtitles?.length > 0 && (
            <div className="relative group">
              <button className="p-2 rounded-full hover:bg-white/10 transition-colors" title="Subtitles">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              </button>
              <div className="absolute right-0 top-full mt-1 bg-vault-bg/95 backdrop-blur border border-vault-border rounded-lg py-1 min-w-48 hidden group-hover:block">
                <button
                  onClick={() => { setActiveSub(null); removeSubtitleTracks(); }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${!activeSub ? 'text-vault-teal' : 'text-white'}`}
                >
                  Off
                </button>
                {playInfo.subtitles.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => loadSubtitle(sub)}
                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${activeSub === sub.id ? 'text-vault-teal' : 'text-white'}`}
                  >
                    {sub.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video */}
      <video
        ref={videoRef}
        className="flex-1 w-full h-full object-contain bg-black"
        controls
        autoPlay
        crossOrigin="anonymous"
      />

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-vault-teal/30 border-t-vault-teal rounded-full animate-spin" />
            <span className="text-white/60 text-sm">Loading stream...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <button onClick={onClose} className="px-4 py-2 rounded bg-vault-accent text-white text-xs">Close</button>
          </div>
        </div>
      )}
    </div>
  );

  function removeSubtitleTracks() {
    const video = videoRef.current;
    if (!video) return;
    while (video.firstChild) video.removeChild(video.firstChild);
  }

  function loadSubtitle(sub) {
    setActiveSub(sub.id);
    const video = videoRef.current;
    if (!video || !sub.url) return;
    removeSubtitleTracks();
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.title;
    track.srclang = sub.code || 'en';
    track.src = sub.url;
    track.default = true;
    video.appendChild(track);
    if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
  }
}
