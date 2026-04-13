import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';

export default function PlexPlayer({ item, onClose }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playInfo, setPlayInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSub, setActiveSub] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [onlineSubs, setOnlineSubs] = useState(null);
  const [subSearching, setSubSearching] = useState(false);
  const [translating, setTranslating] = useState(null);
  const [appTranslated, setAppTranslated] = useState([]);
  const [subSearchQuery, setSubSearchQuery] = useState('');
  const [mediaInfo, setMediaInfo] = useState(null);
  const hideTimer = useRef(null);
  const [timeOffset, setTimeOffset] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekbarValue, setSeekbarValue] = useState(0);

  // Fetch playback info from server
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/plex/play/${item.id}?server=${encodeURIComponent(item.serverUrl)}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setPlayInfo(data);

        // Build media info string
        const parts = [data.resolution, data.videoCodec, data.audioCodec, data.container].filter(Boolean);
        if (parts.length) setMediaInfo(parts.join(' · '));
      } catch (err) { setError(err.message); }
    };
    load();
  }, [item.id, item.serverUrl]);

  // ── Start playback ────────────────────────────────────────────────────────
  // direct / remux / remux-audio: streamed as fragmented MP4 → native <video>
  // transcode: Plex HLS → HLS.js
  useEffect(() => {
    if (!playInfo || !videoRef.current) return;
    const video = videoRef.current;
    if (!playInfo.streamUrl) { setError('No playback URL'); return; }

    // Cleanup previous HLS instance
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    // Append JWT token to stream URL so <video> / HLS.js can pass auth
    const token = localStorage.getItem('mediavault_token');
    const sep = playInfo.streamUrl.includes('?') ? '&' : '?';
    const url = token ? `${playInfo.streamUrl}${sep}token=${encodeURIComponent(token)}` : playInfo.streamUrl;
    const mode = playInfo.playbackMode || '';
    const isHlsMode = mode === 'transcode';

    if (isHlsMode && Hls.isSupported()) {
      // Plex HLS transcode fallback — use HLS.js
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 120,
        enableWorker: true,
        startLevel: -1,
        fragLoadingTimeOut: 30000,
        manifestLoadingTimeOut: 20000,
      });
      hlsRef.current = hls;
      let retries = 0;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) {
            retries++;
            hls.recoverMediaError();
          } else {
            setError(`Playback error: ${data.details}`);
          }
        }
      });
    } else if (isHlsMode && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = url;
      video.addEventListener('canplay', () => setLoading(false), { once: true });
      video.addEventListener('error', () => setError('Playback failed'), { once: true });
      video.play().catch(() => {});
    } else {
      // direct / remux / remux-audio — all served as MP4, plays natively
      video.src = url;

      // For remux modes, set duration manually and handle seeking
      const isRemuxMode = mode === 'remux' || mode === 'remux-audio';
      if (isRemuxMode) {
        const durationMs = playInfo.duration || 0;
        const durationSec = durationMs / 1000;
        setTotalDuration(durationSec);

        // Track time updates to sync display with offset
        const handleTimeUpdate = () => {
          setDisplayTime(timeOffset + video.currentTime);
          setSeekbarValue(timeOffset + video.currentTime);
          setIsPlaying(!video.paused);
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', () => setIsPlaying(true));
        video.addEventListener('pause', () => setIsPlaying(false));
      }

      video.addEventListener('loadeddata', () => setLoading(false), { once: true });
      video.addEventListener('canplay', () => setLoading(false), { once: true });
      video.addEventListener('error', () => {
        console.error('[PlexPlayer] native error:', video.error?.message, video.error?.code);
        setError('Playback failed — check server logs for details');
      }, { once: true });
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [playInfo]);

  // Escape key
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { showSubMenu ? setShowSubMenu(false) : onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, showSubMenu]);

  // Auto-hide controls
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!showSubMenu) setShowControls(false); }, 3000);
  }, [showSubMenu]);

  useEffect(() => {
    showControlsTemporarily();
    return () => clearTimeout(hideTimer.current);
  }, [showControlsTemporarily]);

  const title = playInfo?.showTitle
    ? `${playInfo.showTitle} — ${playInfo.episode} — ${playInfo.title}`
    : playInfo?.title || item.title;

  // ── Search OpenSubtitles ──────────────────────────────────────────────────
  const searchOnlineSubs = async (lang = 'en') => {
    setSubSearching(true);
    try {
      const params = new URLSearchParams({ lang });
      const customQuery = subSearchQuery.trim();
      if (customQuery) {
        params.set('query', customQuery);
      } else if (playInfo?.showTitle) {
        params.set('query', playInfo.showTitle);
      } else {
        params.set('query', playInfo?.title || item.title);
      }
      // Add episode info unless user typed a custom query
      if (!customQuery && playInfo?.episode) {
        const ep = playInfo.episode.match(/S(\d+)E(\d+)/);
        if (ep) { params.set('season', ep[1]); params.set('episode', ep[2]); }
      }
      const res = await fetch(`/api/subtitles/search?${params}`);
      const data = await res.json();
      setOnlineSubs(data.subtitles || []);
    } catch { setOnlineSubs([]); }
    finally { setSubSearching(false); }
  };

  // ── Load an online subtitle (preview / test) ─────────────────────────────
  const loadOnlineSub = async (sub) => {
    if (!sub.fileId) return;
    setActiveSub(`online_${sub.id}`);
    const video = videoRef.current;
    if (!video) return;
    removeSubtitleTracks();
    let subUrl = sub.downloadUrl
      ? `/api/subtitles/download?url=${encodeURIComponent(sub.downloadUrl)}`
      : `/api/subtitles/download?fileId=${sub.fileId}`;
    const token = localStorage.getItem('mediavault_token');
    if (token) subUrl += `&token=${encodeURIComponent(token)}`;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.title;
    track.srclang = sub.language;
    track.src = subUrl;
    track.default = true;
    video.appendChild(track);
    track.addEventListener('load', () => {
      if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
    });
    if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
  };

  // ── Translate an online subtitle ──────────────────────────────────────────
  const translateOnlineSub = async (sub, toLang) => {
    if (!sub.fileId) return;
    setTranslating(`${sub.fileId}_${toLang}`);
    try {
      const translateParams = sub.downloadUrl
        ? `url=${encodeURIComponent(sub.downloadUrl)}&from=${sub.language}&to=${toLang}`
        : `fileId=${sub.fileId}&from=${sub.language}&to=${toLang}`;
      const res = await fetch(`/api/subtitles/translate?${translateParams}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const vttText = await res.text();
      if (!vttText.startsWith('WEBVTT')) throw new Error('Invalid response');

      const blob = new Blob([vttText], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(blob);
      const label = `${toLang.toUpperCase()} — translated from ${sub.language.toUpperCase()}`;
      const id = `app_${sub.fileId}_${toLang}`;

      // Add to app translated list (avoid duplicates)
      setAppTranslated((prev) => prev.some((t) => t.id === id) ? prev : [...prev, { id, label, blobUrl, lang: toLang }]);

      // Activate immediately
      loadTrackFromUrl(blobUrl, label, toLang, id);
    } catch (err) {
      setError(`Translation failed: ${err.message}`);
      setTimeout(() => setError(null), 5000);
    } finally { setTranslating(null); }
  };

  // ── "Test source" — search OS for English, load for preview ───────────────
  const testSourceSub = async () => {
    await searchOnlineSubs('en');
  };

  // ── Load a track from blob URL ────────────────────────────────────────────
  function loadTrackFromUrl(url, label, lang, id) {
    setActiveSub(id);
    const video = videoRef.current;
    if (!video) return;
    removeSubtitleTracks();
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = label;
    track.srclang = lang;
    track.src = url;
    track.default = true;
    video.appendChild(track);
    if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
  }

  function removeSubtitleTracks() {
    const video = videoRef.current;
    if (!video) return;
    video.querySelectorAll('track').forEach((t) => t.remove());
  }

  function handleSeek(targetSeconds) {
    const video = videoRef.current;
    if (!video || !playInfo) return;

    setTimeOffset(targetSeconds);
    setDisplayTime(targetSeconds);
    setSeekbarValue(targetSeconds);

    const token = localStorage.getItem('mediavault_token');
    const baseUrl = playInfo.streamUrl;
    const sep = baseUrl.includes('?') ? '&' : '?';
    let newUrl = `${baseUrl}${sep}start=${Math.floor(targetSeconds)}`;
    if (token) newUrl += `&token=${encodeURIComponent(token)}`;

    video.src = newUrl;
    video.play().catch(() => {});
  }

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function loadEmbeddedSub(sub) {
    setActiveSub(sub.id);
    const video = videoRef.current;
    if (!video || !sub.url) return;
    removeSubtitleTracks();
    const token = localStorage.getItem('mediavault_token');
    const sep = sub.url.includes('?') ? '&' : '?';
    const subUrl = token ? `${sub.url}${sep}token=${encodeURIComponent(token)}` : sub.url;
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.title;
    track.srclang = sub.code || 'en';
    track.src = subUrl;
    track.default = true;
    video.appendChild(track);
    if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onMouseMove={showControlsTemporarily}
      onClick={(e) => { if (e.target === e.currentTarget) showControlsTemporarily(); }}
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
          {/* Playback mode + codec info */}
          <div className="flex items-center gap-2 shrink-0">
            {playInfo?.playbackMode && (
              <span className={`text-[9px] px-2 py-1 rounded font-bold uppercase tracking-wider ${
                playInfo.playbackMode === 'direct' ? 'bg-green-500/20 text-green-400' :
                playInfo.playbackMode === 'remux' ? 'bg-blue-500/20 text-blue-400' :
                playInfo.playbackMode === 'remux-audio' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-orange-500/20 text-orange-400'
              }`}>
                {playInfo.playbackMode === 'direct' ? 'ORIGINAL' :
                 playInfo.playbackMode === 'remux' ? 'REMUX' :
                 playInfo.playbackMode === 'remux-audio' ? 'REMUX+AUDIO' :
                 'TRANSCODE'}
              </span>
            )}
            {mediaInfo && (
              <span className="text-[9px] text-vault-muted bg-white/10 px-2 py-1 rounded font-mono">
                {mediaInfo}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowSubMenu(!showSubMenu)}
            className={`p-2 rounded-full hover:bg-white/10 transition-colors ${activeSub ? 'text-vault-teal' : 'text-white'}`}
            title="Subtitles"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Subtitle Panel ─────────────────────────────────────────────────── */}
      {showSubMenu && (
        <div className="absolute top-16 right-4 z-20 w-80 max-h-[70vh] bg-vault-bg/95 backdrop-blur border border-vault-border rounded-lg flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-vault-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-vault-muted">Subtitles</h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── App Translated (top priority) ──────────────────────────── */}
            {appTranslated.length > 0 && (
              <div className="px-1 py-1 border-b border-vault-border/50">
                <p className="px-2 py-1 text-[9px] uppercase tracking-wider text-vault-teal font-bold">App Translated</p>
                {appTranslated.map((t) => (
                  <div key={t.id} className="flex items-center gap-1 px-1">
                    <button
                      onClick={() => loadTrackFromUrl(t.blobUrl, t.label, t.lang, t.id)}
                      className={`flex-1 px-2 py-1.5 text-left text-xs rounded hover:bg-white/10 truncate ${activeSub === t.id ? 'text-vault-teal' : 'text-white'}`}
                    >
                      {t.label}
                    </button>
                    <button
                      onClick={() => {
                        setAppTranslated((prev) => prev.filter((x) => x.id !== t.id));
                        if (activeSub === t.id) { setActiveSub(null); removeSubtitleTracks(); }
                        URL.revokeObjectURL(t.blobUrl);
                      }}
                      className="p-1 rounded text-vault-muted/50 hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
                      title="Delete"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Off + Embedded subs ─────────────────────────────────────── */}
            <div className="px-1 py-1 border-b border-vault-border/50">
              <button
                onClick={() => { setActiveSub(null); removeSubtitleTracks(); }}
                className={`w-full px-3 py-1.5 text-left text-xs rounded hover:bg-white/10 ${!activeSub ? 'text-vault-teal' : 'text-white'}`}
              >
                Off
              </button>
              {(playInfo?.subtitles || []).map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => loadEmbeddedSub(sub)}
                  className={`w-full px-3 py-1.5 text-left text-xs rounded hover:bg-white/10 ${activeSub === sub.id ? 'text-vault-teal' : 'text-white'}`}
                >
                  {sub.title} <span className="text-vault-muted">(embedded)</span>
                </button>
              ))}
            </div>

            {/* ── OpenSubtitles search + test ─────────────────────────────── */}
            <div className="px-3 py-2 border-b border-vault-border/50">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-vault-muted shrink-0">OpenSubtitles</span>
                {['en', 'da', 'sv', 'no', 'de', 'fr', 'es', 'ja'].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => searchOnlineSubs(lang)}
                    className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-vault-card text-vault-muted hover:text-white hover:bg-vault-border transition-colors"
                  >
                    {lang}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={subSearchQuery}
                onChange={(e) => setSubSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchOnlineSubs('en'); }}
                placeholder={playInfo?.showTitle || playInfo?.title || 'Search title...'}
                className="mt-1.5 w-full px-2 py-1 rounded bg-vault-card/50 border border-vault-border/50 text-[10px] text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50"
              />
              <p className="text-[9px] text-vault-muted mt-1">Type a different title if auto-search finds nothing. Test first, then translate.</p>
            </div>

            {/* ── Online results ──────────────────────────────────────────── */}
            <div className="px-1 py-1">
              {subSearching && <p className="text-xs text-vault-muted px-3 py-2 animate-pulse">Searching...</p>}

              {onlineSubs && !subSearching && onlineSubs.length === 0 && (
                <p className="text-xs text-vault-muted px-3 py-2">No subtitles found.</p>
              )}

              {onlineSubs && !subSearching && onlineSubs.map((sub) => (
                <div key={sub.id} className="px-2 py-1 border-b border-vault-border/30 last:border-0">
                  {/* Load / test button */}
                  <button
                    onClick={() => loadOnlineSub(sub)}
                    className={`w-full px-2 py-1 text-left text-xs rounded hover:bg-white/10 ${activeSub === `online_${sub.id}` ? 'text-vault-teal' : 'text-white'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate flex-1">{sub.title}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-vault-teal/20 text-vault-teal shrink-0">Test</span>
                    </div>
                    <div className="text-[10px] text-vault-muted">
                      {sub.language.toUpperCase()} · {sub.downloads} downloads{sub.hearing_impaired ? ' · HI' : ''}
                    </div>
                  </button>

                  {/* Translate row */}
                  <div className="flex gap-1 ml-3 mt-1 mb-1 items-center">
                    {translating === `${sub.fileId}_${undefined}` ? null : null}
                    <span className="text-[9px] text-vault-muted shrink-0 py-0.5">Translate →</span>
                    {['da', 'en', 'sv', 'no', 'de', 'fr', 'es', 'th'].filter((l) => l !== sub.language).map((lang) => {
                      const isTranslating = translating === `${sub.fileId}_${lang}`;
                      return (
                        <button
                          key={lang}
                          onClick={() => translateOnlineSub(sub, lang)}
                          disabled={!!translating}
                          className={`px-1 py-0.5 rounded text-[9px] uppercase transition-colors ${
                            isTranslating
                              ? 'bg-vault-teal/30 text-vault-teal animate-pulse'
                              : 'bg-vault-card/50 text-vault-muted hover:text-vault-teal hover:bg-vault-teal/10 disabled:opacity-30'
                          }`}
                        >
                          {lang}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {!onlineSubs && !subSearching && (
                <p className="text-xs text-vault-muted px-3 py-2">Click a language above to search.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        className="flex-1 w-full h-full object-contain bg-black"
        controls={playInfo?.playbackMode !== 'remux' && playInfo?.playbackMode !== 'remux-audio'}
        autoPlay
        crossOrigin="anonymous"
      />

      {/* Custom controls for remux modes */}
      {(playInfo?.playbackMode === 'remux' || playInfo?.playbackMode === 'remux-audio') && (
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent pt-8 pb-3 px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  if (video.paused) video.play();
                  else video.pause();
                }
              }}
              className="p-2 rounded hover:bg-white/10 transition-colors text-white shrink-0"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span className="text-xs text-white/80 shrink-0 w-12 text-right">
              {formatTime(displayTime)}
            </span>

            <input
              type="range"
              min="0"
              max={Math.ceil(totalDuration)}
              value={seekbarValue}
              onChange={(e) => {
                const target = parseFloat(e.target.value);
                handleSeek(target);
              }}
              className="flex-1 h-1 bg-white/20 rounded appearance-none cursor-pointer accent-vault-teal"
            />

            <span className="text-xs text-white/80 shrink-0 w-12">
              {formatTime(totalDuration)}
            </span>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-3 border-vault-teal/30 border-t-vault-teal rounded-full animate-spin" />
            <span className="text-white/60 text-sm">
              {playInfo?.playbackReason || 'Loading stream...'}
            </span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="text-center pointer-events-auto">
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <button onClick={() => setError(null)} className="px-4 py-2 rounded bg-vault-accent text-white text-xs mr-2">Dismiss</button>
            <button onClick={onClose} className="px-4 py-2 rounded bg-vault-card text-white text-xs">Close Player</button>
          </div>
        </div>
      )}
    </div>
  );
}
