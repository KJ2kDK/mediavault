import { useState } from 'react';

export default function MediaCard({ item, size = 'md', onPlay, onInfo }) {
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
      className={`${sizes[size]} relative rounded-lg overflow-hidden cursor-pointer media-card shrink-0`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPlay?.(item)}
    >
      {/* Background */}
      {item.thumb && !imgError ? (
        <img
          src={item.thumb}
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
    </div>
  );
}
