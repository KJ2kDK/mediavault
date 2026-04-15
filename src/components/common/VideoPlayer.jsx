import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Seedbox video player — streams fMP4 chunks via MediaSource Extensions.
 * Backend: /api/seedbox/play/:id returns playback info + stream URL.
 */
export default function VideoPlayer({ item, onClose }) {
  const videoRef = useRef(null);
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
  const timeOffsetRef = useRef(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekbarValue, setSeekbarValue] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('mediavault_volume');
    return saved != null ? parseFloat(saved) : 1;
  });
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // Fetch playback info from the seedbox backend
  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('mediavault_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/seedbox/play/${item.id}`, { headers });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setPlayInfo(data);

        // Build media info string
        const parts = [data.resolution, data.videoCodec, data.audioCodec, data.container].filter(Boolean);
        if (parts.length) setMediaInfo(parts.join(' · '));

        // Auto-load the first available subtitle (pre-cached on server)
        if (data.subtitles?.length > 0) {
          const firstSub = data.subtitles[0];
          setTimeout(() => loadSubtitleFromUrl(firstSub.url, firstSub.id), 500);
        }
      } catch (err) { setError(err.message); }
    };
    load();
  }, [item.id]);

  // Ref to abort any in-flight stream fetch (critical for React StrictMode)
  const abortRef = useRef(null);

  // ── Start playback ────────────────────────────────────────────────────────
  // Seedbox returns one of:
  //   direct       — browser-compatible container/codecs, plain <video src>
  //   remux        — fMP4 over MSE (FFmpeg copy codecs to MP4)
  //   remux-audio  — fMP4 over MSE (audio transcoded to AAC)
  //   transcode    — fMP4 over MSE (full transcode)
  useEffect(() => {
    if (!playInfo || !videoRef.current) return;
    const video = videoRef.current;
    if (!playInfo.streamUrl) { setError('No playback URL'); return; }

    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

    const token = localStorage.getItem('mediavault_token');
    const sep = playInfo.streamUrl.includes('?') ? '&' : '?';
    const url = token ? `${playInfo.streamUrl}${sep}token=${encodeURIComponent(token)}` : playInfo.streamUrl;
    const mode = playInfo.playbackMode || '';
    const isFmp4Mode = mode === 'remux' || mode === 'remux-audio' || mode === 'transcode';
    const durationMs = playInfo.duration || 0;
    const durationSec = durationMs / 1000;

    if (isFmp4Mode) setTotalDuration(durationSec);

    const handleTimeUpdate = () => {
      const t = timeOffsetRef.current + video.currentTime;
      setDisplayTime(t);
      setSeekbarValue(t);
      setIsPlaying(!video.paused);
    };
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', () => setIsPlaying(true));
    video.addEventListener('pause', () => setIsPlaying(false));

    // fMP4 streams require MSE (browser can't seek a live FFmpeg pipe via plain <video src>).
    if (isFmp4Mode && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028, mp4a.40.2"')) {
      startMSEStream(video, url, token, playInfo);
    } else {
      // Direct play
      video.src = url;
      if (!isFmp4Mode) {
        video.addEventListener('loadedmetadata', () => {
          setTotalDuration(video.duration);
        }, { once: true });
      }
    }

    video.addEventListener('loadeddata', () => setLoading(false), { once: true });
    video.addEventListener('canplay', () => setLoading(false), { once: true });
    video.addEventListener('error', () => {
      console.error('[VideoPlayer] native error:', video.error?.message, video.error?.code);
      setError('Playback failed — check server logs for details');
    }, { once: true });

    if (!isFmp4Mode || typeof MediaSource === 'undefined') {
      video.play().catch(() => {});
    }

    return () => {
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      if (videoRef.current?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(videoRef.current.src);
      }
    };
  }, [playInfo]);

  // ── Watch progress: auto-save every 10s + resume on load ──────────────────
  useEffect(() => {
    if (!playInfo || !videoRef.current) return;

    const video = videoRef.current;
    const itemId = `seedbox:${item.id}`;
    const itemType = playInfo.showTitle ? 'series' : 'vod';
    const durationSec = (playInfo.duration || 0) / 1000;

    // Resume: seek to saved position if > 30s in and not near end
    let didResume = false;
    const tryResume = () => {
      if (didResume) return;
      didResume = true;
      const resumeAt = Number(playInfo.resumeAt) || 0;
      if (resumeAt > 30 && (!durationSec || resumeAt < durationSec - 60)) {
        try { video.currentTime = resumeAt; } catch {}
      }
    };
    video.addEventListener('loadedmetadata', tryResume, { once: true });
    if (video.readyState >= 1) tryResume();

    // Auto-save every 10s
    const saveProgress = () => {
      const pos = timeOffsetRef.current + video.currentTime;
      if (!pos || pos < 5) return;
      fetch('/api/library/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          type: itemType,
          title: playInfo.showTitle || playInfo.title || item.title,
          thumb: playInfo.thumb || item.thumb || null,
          progress: Math.floor(pos),
          duration: Math.floor(durationSec) || null,
        }),
      }).catch(() => {});
    };

    const interval = setInterval(saveProgress, 10000);
    return () => { clearInterval(interval); saveProgress(); };
  }, [playInfo, item.id, item.title, item.thumb]);

  /**
   * Start a MediaSource Extensions stream.
   * Fetches fMP4 data and pumps it into a SourceBuffer.
   * AbortController ensures clean teardown on StrictMode double-render.
   */
  function startMSEStream(video, url, token, info) {
    const abortController = new AbortController();
    abortRef.current = abortController;

    const mediaSource = new MediaSource();
    const blobUrl = URL.createObjectURL(mediaSource);
    video.src = blobUrl;

    mediaSource.addEventListener('sourceopen', async () => {
      if (abortController.signal.aborted) return;

      let mimeType = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';
      if (info.videoCodec === 'hevc' || info.videoCodec === 'h265') {
        mimeType = 'video/mp4; codecs="hvc1.1.6.L120.90, mp4a.40.2"';
      }
      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.mode = 'segments';

      try {
        const fetchHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(url, {
          headers: fetchHeaders,
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error(`Stream HTTP ${response.status}`);

        const reader = response.body.getReader();
        let firstAppend = true;

        const pump = async () => {
          while (true) {
            if (abortController.signal.aborted) { reader.cancel(); return; }

            const { done, value } = await reader.read();
            if (done) {
              if (mediaSource.readyState === 'open') {
                if (sourceBuffer.updating) {
                  await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
                }
                mediaSource.endOfStream();
              }
              break;
            }

            if (sourceBuffer.updating) {
              await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));
            }
            sourceBuffer.appendBuffer(value);
            await new Promise(r => sourceBuffer.addEventListener('updateend', r, { once: true }));

            if (firstAppend) {
              firstAppend = false;
              setLoading(false);
              video.play().catch(() => {});
            }
          }
        };

        pump().catch(err => {
          if (err.name === 'AbortError') return;
          console.error('[VideoPlayer] MSE pump error:', err);
          if (mediaSource.readyState === 'open') setError('Stream interrupted');
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[VideoPlayer] MSE fetch error:', err);
        setError('Failed to start stream');
      }
    });
  }

  // Escape key + keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') { showSubMenu ? setShowSubMenu(false) : onClose(); }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'm' || e.key === 'M') setMuted(prev => !prev);
      if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) v.paused ? v.play() : v.pause();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, showSubMenu]);

  // Sync volume + mute to video element and persist
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    localStorage.setItem('mediavault_volume', String(volume));
  }, [volume, muted, playInfo]);

  // Track fullscreen changes (user pressing F11, or ESC to exit)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

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
    const subUrl = sub.downloadUrl
      ? `/api/subtitles/download?url=${encodeURIComponent(sub.downloadUrl)}`
      : `/api/subtitles/download?fileId=${sub.fileId}`;
    await loadSubtitleFromUrl(subUrl, `online_${sub.id}`);
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
  async function loadTrackFromUrl(url, label, lang, id) {
    // Fetch the blob URL, parse cues, drive the HTML overlay
    try {
      const res = await fetch(url);
      const vttText = await res.text();
      const cues = parseVTTCues(vttText);
      console.log(`[VideoPlayer] Translated track: ${cues.length} cues`);
      setActiveSub(id);
      setSubCues(cues);
      setSubText('');
    } catch (err) {
      console.error('[VideoPlayer] Failed to load translated track:', err.message);
    }
  }

  function removeSubtitleTracks() {
    const video = videoRef.current;
    if (video) video.querySelectorAll('track').forEach((t) => t.remove());
    setSubCues([]);
    setSubText('');
  }

  function handleSeek(targetSeconds) {
    const video = videoRef.current;
    if (!video || !playInfo) return;

    timeOffsetRef.current = targetSeconds;
    setDisplayTime(targetSeconds);
    setSeekbarValue(targetSeconds);
    setLoading(true);

    // Abort any current stream
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

    const token = localStorage.getItem('mediavault_token');
    const baseUrl = playInfo.streamUrl;
    const sep = baseUrl.includes('?') ? '&' : '?';
    let newUrl = `${baseUrl}${sep}start=${Math.floor(targetSeconds)}`;
    if (token) newUrl += `&token=${encodeURIComponent(token)}`;

    const mode = playInfo.playbackMode || '';
    const isRemuxMode = mode === 'remux' || mode === 'remux-audio';

    // Revoke old blob URL if any
    if (video.src?.startsWith('blob:')) URL.revokeObjectURL(video.src);

    if (isRemuxMode && typeof MediaSource !== 'undefined') {
      startMSEStream(video, newUrl, token, playInfo);
    } else {
      video.src = newUrl;
      video.addEventListener('canplay', () => setLoading(false), { once: true });
      video.play().catch(() => {});
    }
  }

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ── Subtitle overlay state ────────────────────────────────────────────────
  // All subtitle cues for the currently active track
  const [subCues, setSubCues] = useState([]);
  // Currently visible cue text (updated every 250ms)
  const [subText, setSubText] = useState('');

  // Interval that matches current playback time to subtitle cues
  useEffect(() => {
    if (subCues.length === 0) { setSubText(''); return; }
    const video = videoRef.current;
    if (!video) return;

    const tick = setInterval(() => {
      const t = timeOffsetRef.current + video.currentTime;
      const active = subCues.filter(c => t >= c.start && t <= c.end);
      setSubText(active.map(c => c.text).join('\n'));
    }, 250);

    return () => clearInterval(tick);
  }, [subCues]);

  /**
   * Load a subtitle track — fetches VTT, parses cues, drives the HTML overlay.
   */
  async function loadSubtitleFromUrl(url, id) {
    setActiveSub(id);
    setSubCues([]);
    setSubText('');

    try {
      const token = localStorage.getItem('mediavault_token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text = await res.text();

      // Convert SRT → VTT if needed
      if (!text.startsWith('WEBVTT')) {
        text = 'WEBVTT\n\n' + text.replace(/\r\n/g, '\n').replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4').replace(/^\d+\n/gm, '');
      }

      const cues = parseVTTCues(text);
      console.log(`[VideoPlayer] Loaded ${cues.length} subtitle cues`);
      setSubCues(cues);
    } catch (err) {
      console.error('[VideoPlayer] Subtitle load failed:', err.message);
    }
  }

  async function loadEmbeddedSub(sub) {
    if (!sub.url) return;
    await loadSubtitleFromUrl(sub.url, sub.id);
  }

  function parseVTTCues(vtt) {
    const cues = [];
    const blocks = vtt.split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/);
        if (m) {
          const start = parseTS(m[1]);
          const end = parseTS(m[2]);
          const text = lines.slice(i + 1).join('\n').trim();
          if (text) cues.push({ start, end, text });
          break;
        }
      }
    }
    return cues;
  }

  function parseTS(ts) {
    const p = ts.replace(',', '.').split(':');
    return p.length === 3
      ? parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2])
      : parseInt(p[0]) * 60 + parseFloat(p[1]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
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
                  {sub.title} <span className="text-vault-muted">({sub.external ? 'file' : 'embedded'})</span>
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
        onDoubleClick={toggleFullscreen}
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
                // While dragging: only update the visual position + time display
                const target = parseFloat(e.target.value);
                setSeekbarValue(target);
                setDisplayTime(target);
              }}
              onMouseUp={(e) => {
                // On release: actually seek
                handleSeek(parseFloat(e.target.value));
              }}
              onTouchEnd={(e) => {
                handleSeek(parseFloat(e.target.value));
              }}
              className="flex-1 h-1 bg-white/20 rounded appearance-none cursor-pointer accent-vault-teal"
            />

            <span className="text-xs text-white/80 shrink-0 w-12">
              {formatTime(totalDuration)}
            </span>

            {/* Volume */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setMuted(prev => !prev)}
                className="p-1.5 rounded hover:bg-white/10 transition-colors text-white"
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {muted || volume === 0 ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  if (v > 0 && muted) setMuted(false);
                }}
                className="w-20 h-1 bg-white/20 rounded appearance-none cursor-pointer accent-vault-teal"
                title={`Volume: ${Math.round((muted ? 0 : volume) * 100)}%`}
              />
            </div>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded hover:bg-white/10 transition-colors text-white shrink-0"
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Subtitle overlay — rendered as HTML for maximum compatibility */}
      {subText && (
        <div className="absolute bottom-20 left-0 right-0 z-10 flex justify-center pointer-events-none px-8">
          <div className="text-center max-w-3xl">
            <p
              className="text-white text-lg leading-relaxed px-3 py-1 inline"
              style={{
                backgroundColor: 'rgba(0,0,0,0.75)',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                whiteSpace: 'pre-wrap',
              }}
              dangerouslySetInnerHTML={{ __html: subText.replace(/\n/g, '<br/>') }}
            />
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
