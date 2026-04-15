import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Manual TMDB match picker for seedbox items.
 * Opens as a modal. User searches TMDB, picks the correct match,
 * backend stores override and applies it immediately.
 */
export default function MatchSearchModal({ item, onClose, onMatched }) {
  const initialQuery = (item.title || '').replace(/\s+\(\d{4}\)\s*$/, '');
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState(item.type === 'show' ? 'tv' : 'movie');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const runSearch = async (q, t) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/seedbox/tmdb/search?q=${encodeURIComponent(q.trim())}&type=${t}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, type), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, type]);

  const applyMatch = async (result) => {
    setApplying(result.tmdbId);
    try {
      const res = await fetch('/api/seedbox/tmdb/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, tmdbId: result.tmdbId, type: result.type }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onMatched?.(data.matched);
      onClose();
    } catch (err) {
      setError(err.message);
      setApplying(null);
    }
  };

  const clearMatch = async () => {
    setApplying('clear');
    try {
      const res = await fetch(`/api/seedbox/tmdb/match/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onMatched?.(null);
      onClose();
    } catch (err) {
      setError(err.message);
      setApplying(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 animate-fade-in"
      onMouseEnter={(e) => e.stopPropagation()}
      onMouseLeave={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="bg-vault-surface border border-vault-border rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-vault-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-vault-text">Fix Match</h2>
            <p className="text-[11px] text-vault-muted mt-0.5 truncate max-w-md">
              {item.filename || item.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search controls */}
        <div className="px-5 py-3 border-b border-vault-border flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg border border-vault-border overflow-hidden shrink-0">
            <button
              onClick={() => setType('movie')}
              className={`px-3 py-1.5 text-xs font-medium transition-all ${type === 'movie' ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-vault-text'}`}
            >
              Movie
            </button>
            <button
              onClick={() => setType('tv')}
              className={`px-3 py-1.5 text-xs font-medium transition-all ${type === 'tv' ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-vault-text'}`}
            >
              TV
            </button>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search TMDB..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-vault-bg border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
          />
          <button
            onClick={clearMatch}
            disabled={applying !== null}
            className="px-3 py-1.5 rounded-lg text-xs text-vault-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            title="Remove manual match (will auto-match next scan)"
          >
            Clear match
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-3">{error}</div>
          )}
          {loading && results.length === 0 && (
            <p className="text-center text-xs text-vault-muted py-12">Searching...</p>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <p className="text-center text-xs text-vault-muted py-12">No results for "{query}"</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {results.map((r) => (
              <button
                key={r.tmdbId}
                onClick={() => applyMatch(r)}
                disabled={applying !== null}
                className={`flex gap-3 p-2 rounded-lg bg-vault-card border border-vault-border hover:border-vault-accent/50 hover:bg-vault-accent/5 transition-all text-left ${applying === r.tmdbId ? 'opacity-50' : ''}`}
              >
                <div className="w-16 h-24 rounded overflow-hidden bg-vault-bg shrink-0">
                  {r.poster ? (
                    <img src={r.poster} alt={r.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-vault-muted/40 text-xs">?</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-vault-text line-clamp-2">{r.title}</p>
                  <p className="text-[10px] text-vault-muted mt-0.5">
                    {r.year || '—'}{r.rating ? ` • ★${r.rating}` : ''}
                  </p>
                  {r.overview && (
                    <p className="text-[10px] text-vault-muted line-clamp-3 mt-1">{r.overview}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
