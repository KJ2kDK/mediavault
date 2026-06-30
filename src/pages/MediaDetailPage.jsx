import { useState, useEffect, useMemo } from 'react';
import TrailerModal from '../components/common/TrailerModal';
import CarouselRow from '../components/common/CarouselRow';
import { useBookmarks } from '../hooks/useBookmarks';

// Append JWT token to internal API URLs so <img> tags pass the auth wall.
function authedUrl(url) {
  if (!url || !url.startsWith('/api/')) return url;
  const token = localStorage.getItem('mediavault_token');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function fmtRuntime(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MediaDetailPage({ selectedMedia, onPlay, onOpenDetail, goBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [activeSeason, setActiveSeason] = useState(null);

  const itemId = selectedMedia?.id;
  const isShow = (detail?.type ?? selectedMedia?.type) === 'show';

  const vodBk = useBookmarks('vod');
  const seriesBk = useBookmarks('series');
  const bk = isShow ? seriesBk : vodBk;
  const isBookmarked = itemId != null && bk.bookmarkedIds.has(itemId);

  useEffect(() => {
    if (itemId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    const token = localStorage.getItem('mediavault_token');
    fetch(`/api/seedbox/detail/${itemId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Detail failed (${r.status})`))))
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        if (Array.isArray(data.seasons) && data.seasons.length > 0) {
          setActiveSeason(data.seasons[0].season);
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [itemId]);

  const data = detail || selectedMedia || {};
  const backdrop = data.backdrop || data.thumb;
  const hasResume = (data.resumeAt || 0) > 30;

  const seasons = detail?.seasons || null;
  const currentSeason = useMemo(
    () => (seasons || []).find((s) => s.season === activeSeason) || (seasons || [])[0],
    [seasons, activeSeason]
  );

  const playItem = (over = {}) => {
    onPlay?.({ id: itemId, title: data.title, backend: 'seedbox', ...over });
  };

  const toggleBookmark = () => {
    bk.toggle({ ...data, backend: 'seedbox' });
  };

  if (itemId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <p className="text-vault-muted text-sm">Nothing selected.</p>
        <button onClick={goBack} className="text-vault-teal text-sm hover:underline">← Go back</button>
      </div>
    );
  }

  const meta = [
    data.year,
    fmtRuntime(detail?.runtime),
    data.rating ? `★ ${data.rating}` : null,
    data.genre || null,
  ].filter(Boolean);

  return (
    <div className="animate-fade-in pb-12">
      {/* Hero */}
      <div className="relative min-h-[460px] w-full">
        {/* Backdrop */}
        {backdrop ? (
          <img
            src={authedUrl(backdrop)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-vault-card to-vault-bg" />
        )}
        {/* Scrims */}
        <div className="absolute inset-0 bg-gradient-to-r from-vault-bg via-vault-bg/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-vault-bg via-vault-bg/20 to-vault-bg/40" />

        {/* Back button */}
        <button
          onClick={goBack}
          className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 text-white/90 hover:bg-black/70 transition-all text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Content */}
        <div className="relative h-full flex items-end gap-6 px-6 md:px-10 pt-32 pb-10">
          {/* Poster */}
          {data.thumb && (
            <img
              src={authedUrl(data.thumb)}
              alt={data.title}
              className="hidden md:block w-44 rounded-xl shadow-2xl shadow-black/50 ring-1 ring-white/10 shrink-0"
            />
          )}

          <div className="flex-1 min-w-0 max-w-3xl">
            {data.type && (
              <span className={`inline-block text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-3 ${data.type === 'show' ? 'bg-vault-teal/20 text-vault-teal' : 'bg-vault-accent/20 text-vault-accent'}`}>
                {data.type === 'show' ? 'Series' : 'Film'}
              </span>
            )}
            <h1 className="font-display text-4xl md:text-5xl tracking-wide text-white leading-tight mb-3">
              {data.title}
            </h1>

            {meta.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-vault-muted mb-4">
                {meta.map((m, i) => (
                  <span key={i} className={m.startsWith?.('★') ? 'text-vault-gold' : ''}>{m}</span>
                ))}
              </div>
            )}

            {data.description && (
              <p className="text-vault-muted text-sm leading-relaxed mb-6 line-clamp-4 max-w-2xl">
                {data.description}
              </p>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => playItem()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-vault-accent hover:bg-vault-accentHover text-white font-semibold text-sm transition-all shadow-lg shadow-vault-accent/25"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {hasResume ? 'Resume' : 'Play'}
              </button>

              {detail?.trailer && (
                <button
                  onClick={() => setShowTrailer(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-vault-card/80 hover:bg-vault-card text-vault-text font-medium text-sm transition-all border border-vault-border"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Watch Trailer
                </button>
              )}

              <button
                onClick={toggleBookmark}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all border ${
                  isBookmarked
                    ? 'bg-vault-gold/15 text-vault-gold border-vault-gold/30'
                    : 'bg-vault-card/80 hover:bg-vault-card text-vault-text border-vault-border'
                }`}
              >
                <svg className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                {isBookmarked ? 'Bookmarked' : 'Bookmark'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="px-6 md:px-10 py-6">
          <div className="h-4 w-40 bg-vault-card rounded animate-pulse" />
        </div>
      )}
      {error && (
        <div className="px-6 md:px-10 py-6">
          <p className="text-sm text-red-400">Couldn't load details: {error}</p>
        </div>
      )}

      {/* Series: season selector + episode list */}
      {seasons && seasons.length > 0 && (
        <div className="px-6 md:px-10 mt-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-display text-xl tracking-wide text-white">Episodes</h2>
            {seasons.length > 1 && (
              <select
                value={activeSeason ?? ''}
                onChange={(e) => setActiveSeason(Number(e.target.value))}
                className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-text focus:outline-none focus:border-vault-accent/50"
              >
                {seasons.map((s) => (
                  <option key={s.season} value={s.season}>Season {s.season}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1">
            {(currentSeason?.episodes || []).map((ep) => {
              const pct = ep.duration ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
              return (
                <button
                  key={ep.id}
                  onClick={() => playItem({ id: ep.id, title: `${data.title} — ${ep.title}` })}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-vault-card transition-colors group text-left"
                >
                  <span className="text-sm text-vault-muted w-8 text-right shrink-0">
                    {ep.episode != null ? ep.episode : '·'}
                  </span>
                  <div className="w-9 h-9 rounded-full bg-vault-card group-hover:bg-vault-accent/90 flex items-center justify-center shrink-0 transition-colors">
                    <svg className="w-4 h-4 text-white/70 group-hover:text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-vault-text truncate group-hover:text-white">
                      {ep.title}
                      {ep.resume && <span className="ml-2 text-[10px] text-vault-teal uppercase tracking-wide">Resume</span>}
                    </p>
                    {pct > 0 && (
                      <div className="mt-1.5 h-0.5 w-40 bg-vault-border rounded-full overflow-hidden">
                        <div className="h-full progress-bar rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cast */}
      {detail?.cast?.length > 0 && (
        <div className="px-6 md:px-10 mt-10">
          <h2 className="font-display text-xl tracking-wide text-white mb-4">Cast</h2>
          <div className="flex gap-4 overflow-x-auto carousel-row pb-2">
            {detail.cast.map((c, i) => (
              <div key={i} className="w-24 shrink-0 text-center">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-vault-card mb-2 ring-1 ring-vault-border">
                  {c.profile ? (
                    <img src={c.profile} alt={c.name} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-vault-muted text-2xl font-display">
                      {c.name?.[0] || '?'}
                    </div>
                  )}
                </div>
                <p className="text-xs font-medium text-vault-text truncate">{c.name}</p>
                {c.character && <p className="text-[10px] text-vault-muted truncate">{c.character}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related */}
      {detail?.recommendations?.length > 0 && (
        <div className="mt-10">
          <CarouselRow
            title="More Like This"
            items={detail.recommendations}
            onPlay={(rec) => rec.inLibrary && playItem({ id: rec.id, title: rec.title })}
            onOpen={(rec) => rec.inLibrary && onOpenDetail?.(rec)}
          />
        </div>
      )}

      {showTrailer && detail?.trailer && (
        <TrailerModal
          trailerKey={detail.trailer}
          title={data.title}
          onClose={() => setShowTrailer(false)}
        />
      )}
    </div>
  );
}
