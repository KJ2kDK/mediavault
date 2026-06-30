import { useState, useEffect } from 'react';

export default function HeroBanner({ items, onPlay, onOpenDetail }) {
  const [current, setCurrent] = useState(0);
  const item = items[current];

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % items.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (!item) return null;

  const genreGradients = {
    'Sci-Fi': 'from-blue-950 via-indigo-950/60',
    Drama: 'from-amber-950 via-stone-950/60',
    Action: 'from-red-950 via-stone-950/60',
    default: 'from-vault-bg via-vault-bg/60',
  };
  const grad = genreGradients[item.genre] || genreGradients.default;

  return (
    <div className="relative h-[420px] w-full overflow-hidden mb-8">
      {/* Background */}
      <div className={`absolute inset-0 bg-gradient-to-r ${grad} to-transparent`} />
      <div className="absolute inset-0 bg-gradient-to-t from-vault-bg via-transparent to-vault-bg/30" />

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end px-6 pb-10 max-w-2xl">
        <div className="flex items-center gap-3 mb-3">
          {item.type && (
            <span className={`text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded ${item.type === 'show' ? 'bg-vault-teal/20 text-vault-teal' : 'bg-vault-accent/20 text-vault-accent'}`}>
              {item.type === 'show' ? 'Series' : 'Film'}
            </span>
          )}
          {item.genre && (
            <span className="text-xs text-vault-muted tracking-wider uppercase">{item.genre}</span>
          )}
          {item.year && (
            <span className="text-xs text-vault-muted">{item.year}</span>
          )}
          {item.rating && (
            <span className="text-xs text-vault-gold">★ {item.rating}</span>
          )}
        </div>

        <h1 className="font-display text-5xl tracking-wide text-white mb-3 leading-tight">
          {item.title}
        </h1>

        {item.description && (
          <p className="text-vault-muted text-sm leading-relaxed mb-5 line-clamp-3">
            {item.description}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => onPlay?.(item)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-vault-accent hover:bg-vault-accentHover text-white font-semibold text-sm transition-all shadow-lg shadow-vault-accent/25 hover:shadow-vault-accent/40"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </button>
          <button
            onClick={() => onOpenDetail?.(item)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-vault-card/80 hover:bg-vault-card text-vault-text font-medium text-sm transition-all border border-vault-border"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            More Info
          </button>
        </div>
      </div>

      {/* Pagination dots */}
      {items.length > 1 && (
        <div className="absolute bottom-4 right-6 flex gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`w-2 h-2 rounded-full transition-all ${i === current ? 'bg-vault-accent w-6' : 'bg-vault-muted/30 hover:bg-vault-muted/50'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
