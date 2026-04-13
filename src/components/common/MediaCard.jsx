import { useState } from 'react';

// Append JWT token to internal API URLs so <img> tags pass the auth wall
function authedUrl(url) {
  if (!url || !url.startsWith('/api/')) return url;
  const token = localStorage.getItem('mediavault_token');
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export default function MediaCard({ item, size = 'md', onPlay, onInfo, isBookmarked, onBookmark }) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

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
      className={`${sizes[size]} relative rounded-lg overflow-hidden cursor-pointer media-card shrink-0 group`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPlay?.(item)}
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
        {item.episode && (
          <span className="text-xs text-vault-teal mt-0.5 block">{item.episode}</span>
        )}

        {/* Progress bar */}
        {item.progress > 0 && (
          <div className="mt-2 h-0.5 w-full bg-vault-border rounded-full overflow-hidden">
            <div className="h-full progress-bar rounded-full" style={{ width: `${item.progress}%` }} />
          </div>
        )}
      </div>

      {/* Hover play button */}
      {hovered && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-vault-accent/90 flex items-center justify-center shadow-lg shadow-vault-accent/30 hover:scale-110 transition-transform">
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Type badge */}
      {item.type && (
        <div className="absolute top-2 left-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${item.type === 'show' ? 'bg-vault-teal/20 text-vault-teal' : 'bg-vault-accent/20 text-vault-accent'}`}>
            {item.type}
          </span>
        </div>
      )}

      {/* Bookmark button */}
      {onBookmark && (
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
    </div>
  );
}
