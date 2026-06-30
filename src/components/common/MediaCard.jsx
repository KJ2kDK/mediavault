import { useState } from 'react';
import MatchSearchModal from './MatchSearchModal';

// Append JWT token to internal API URLs so <img> tags pass the auth wall
function authedUrl(url) {
  if (!url || !url.startsWith('/api/')) return url;
  const token = localStorage.getItem('mediavault_token');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export default function MediaCard({ item, size = 'md', onPlay, onOpen, onInfo, isBookmarked, onBookmark, onMatched, selectable, selected, onToggleSelect }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const isSeedbox = item.backend === 'seedbox';

  const sizes = {
    sm: 'w-36 h-52',
    md: 'w-44 h-64',
    lg: 'w-52 h-72',
  };

  const genreColors = {
    'Sci-Fi': 'from-blue-900/80 to-indigo-950/90',
    Drama: 'from-amber-900/80 to-stone-950/90',
    Action: 'from-red-900/80 to-stone-950/90',
    Comedy: 'from-yellow-900/80 to-orange-950/90',
    Horror: 'from-zinc-900/80 to-black/90',
    Thriller: 'from-slate-900/80 to-gray-950/90',
    Documentary: 'from-teal-900/80 to-emerald-950/90',
    Animation: 'from-purple-900/80 to-violet-950/90',
    default: 'from-vault-card to-vault-bg',
  };

  const gradient = genreColors[item.genre] || genreColors.default;

  return (
    <div
      className={`${sizes[size]} relative rounded-xl overflow-hidden cursor-pointer media-card shrink-0 group transition-all duration-200 ${
        selectable && selected
          ? 'ring-2 ring-vault-accent scale-[0.97]'
          : 'ring-1 ring-white/5 hover:ring-2 hover:ring-vault-accent/60 hover:scale-[1.03]'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => (selectable ? onToggleSelect?.(item) : (onOpen ?? onPlay)?.(item))}
    >
      {/* Background */}
      {item.thumb && !imgError ? (
        <img
          src={authedUrl(item.thumb)}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`}>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-3xl text-white/20 text-center leading-tight px-2">
              {item.title}
            </span>
          </div>
        </div>
      )}

      {/* Bottom gradient */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      {/* Info overlay */}
      <div className="absolute inset-x-0 bottom-0 p-3">
        <h3 className="font-body text-sm font-semibold text-white leading-tight line-clamp-2">
          {item.title}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          {item.year && <span className="text-xs text-vault-muted">{item.year}</span>}
          {item.rating && (
            <span className="text-xs text-vault-gold flex items-center gap-0.5">
              ★ {item.rating}
            </span>
          )}
        </div>
        {item.subtitle ? (
          <span className="text-xs text-vault-teal mt-0.5 block">{item.subtitle}</span>
        ) : item.episode ? (
          <span className="text-xs text-vault-teal mt-0.5 block">{item.episode}</span>
        ) : null}

        {/* Progress bar */}
        {item.progress > 0 && (
          <div className="mt-2 h-0.5 w-full bg-vault-border rounded-full overflow-hidden">
            <div className="h-full progress-bar rounded-full" style={{ width: `${item.progress}%` }} />
          </div>
        )}
      </div>

      {/* Selection overlay + checkbox */}
      {selectable && (
        <>
          <div className={`absolute inset-0 transition-colors ${selected ? 'bg-vault-accent/25' : 'bg-black/0 group-hover:bg-black/20'}`} />
          <div
            className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
              selected
                ? 'bg-vault-accent border-vault-accent'
                : 'bg-black/50 border-white/70'
            }`}
          >
            {selected && (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </>
      )}

      {/* Hover play button — direct play (bypasses detail) */}
      {!selectable && hovered && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay?.(item); }}
            className="w-12 h-12 rounded-full bg-vault-accent/90 flex items-center justify-center shadow-lg shadow-vault-accent/30 hover:scale-110 transition-transform"
            title="Play"
          >
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      {/* Type badge */}
      {item.type && !selectable && (
        <div className="absolute top-2 left-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${item.type === 'show' ? 'bg-vault-teal/20 text-vault-teal' : 'bg-vault-accent/20 text-vault-accent'}`}>
            {item.type}
          </span>
        </div>
      )}

      {/* Bookmark button */}
      {onBookmark && !selectable && (
        <button
          onClick={(e) => { e.stopPropagation(); onBookmark(item); }}
          className={`absolute top-2 right-2 p-1 rounded-full bg-black/50 transition-all ${
            isBookmarked
              ? 'text-vault-gold opacity-100'
              : 'text-white/70 opacity-0 group-hover:opacity-100 hover:text-vault-gold'
          }`}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          <svg className="w-3.5 h-3.5" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
        </button>
      )}

      {/* Fix Match button (seedbox items only) */}
      {isSeedbox && !selectable && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMatch(true); }}
          className={`absolute top-2 ${onBookmark ? 'right-9' : 'right-2'} p-1 rounded-full bg-black/50 text-white/70 opacity-0 group-hover:opacity-100 hover:text-vault-teal transition-all`}
          title="Fix match — search TMDB manually"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {/* Match modal */}
      {showMatch && (
        <MatchSearchModal
          item={item}
          onClose={() => setShowMatch(false)}
          onMatched={(meta) => { setShowMatch(false); onMatched?.(meta); }}
        />
      )}
    </div>
  );
}
