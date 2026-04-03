import { useState } from 'react';
import { usePlexLibrary } from '../hooks/usePlex';
import MediaCard from '../components/common/MediaCard';
import CarouselRow from '../components/common/CarouselRow';

const FILTERS = ['All', 'Movies', 'TV Shows', 'Music', '4K', 'Unwatched'];

const DEMO_ALL = [
  { id: 101, title: 'Oppenheimer', year: 2023, rating: '8.3', type: 'movie', genre: 'Drama' },
  { id: 102, title: 'Barbie', year: 2023, rating: '6.8', type: 'movie', genre: 'Comedy' },
  { id: 103, title: 'The Bear', year: 2023, rating: '8.6', type: 'show', genre: 'Drama' },
  { id: 104, title: 'Succession', year: 2023, rating: '8.8', type: 'show', genre: 'Drama' },
  { id: 105, title: 'John Wick 4', year: 2023, rating: '7.7', type: 'movie', genre: 'Action' },
  { id: 106, title: 'Asteroid City', year: 2023, rating: '6.5', type: 'movie', genre: 'Comedy' },
  { id: 107, title: 'Silo', year: 2023, rating: '7.9', type: 'show', genre: 'Sci-Fi' },
  { id: 108, title: 'The Last of Us', year: 2023, rating: '8.8', type: 'show', genre: 'Drama' },
  { id: 109, title: 'Guardians Vol. 3', year: 2023, rating: '7.9', type: 'movie', genre: 'Action' },
  { id: 110, title: 'Beef', year: 2023, rating: '7.7', type: 'show', genre: 'Comedy' },
  { id: 111, title: 'Dune: Part Two', year: 2024, rating: '8.6', type: 'movie', genre: 'Sci-Fi' },
  { id: 112, title: 'Shogun', year: 2024, rating: '8.7', type: 'show', genre: 'Drama' },
  { id: 113, title: 'Fallout', year: 2024, rating: '8.5', type: 'show', genre: 'Sci-Fi' },
  { id: 114, title: 'Civil War', year: 2024, rating: '7.0', type: 'movie', genre: 'Action' },
  { id: 115, title: 'Challengers', year: 2024, rating: '7.8', type: 'movie', genre: 'Drama' },
  { id: 116, title: 'Ripley', year: 2024, rating: '7.8', type: 'show', genre: 'Thriller' },
];

export default function LibraryPage({ searchQuery }) {
  const { library, connected } = usePlexLibrary();
  const [activeFilter, setActiveFilter] = useState('All');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [sortBy, setSortBy] = useState('title'); // 'title' | 'year' | 'rating'

  let items = connected ? (library?.all || []) : DEMO_ALL;

  // Filter
  if (activeFilter === 'Movies') items = items.filter((i) => i.type === 'movie');
  else if (activeFilter === 'TV Shows') items = items.filter((i) => i.type === 'show');

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter((i) => i.title.toLowerCase().includes(q));
  }

  // Sort
  items = [...items].sort((a, b) => {
    if (sortBy === 'year') return (b.year || 0) - (a.year || 0);
    if (sortBy === 'rating') return parseFloat(b.rating || 0) - parseFloat(a.rating || 0);
    return a.title.localeCompare(b.title);
  });

  return (
    <div className="p-6 animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        {/* Filters */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeFilter === f
                  ? 'bg-vault-accent text-white'
                  : 'bg-vault-card text-vault-muted hover:text-vault-text border border-vault-border'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-vault-card border border-vault-border text-vault-text focus:outline-none focus:border-vault-accent/50"
          >
            <option value="title">Sort: Title</option>
            <option value="year">Sort: Year</option>
            <option value="rating">Sort: Rating</option>
          </select>

          {/* View toggle */}
          <div className="flex bg-vault-card rounded-lg border border-vault-border overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 ${viewMode === 'grid' ? 'bg-vault-accent/20 text-vault-accent' : 'text-vault-muted hover:text-vault-text'}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 ${viewMode === 'list' ? 'bg-vault-accent/20 text-vault-accent' : 'text-vault-muted hover:text-vault-text'}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <p className="text-xs text-vault-muted mb-4">
        {items.length} items {activeFilter !== 'All' && `in ${activeFilter}`}
        {searchQuery && ` matching "${searchQuery}"`}
      </p>

      {/* Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} size="md" />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="space-y-1">
          {items.map((item, i) => (
            <div
              key={item.id}
              className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-vault-card transition-colors group cursor-pointer"
            >
              <span className="text-xs text-vault-muted w-6 text-right">{i + 1}</span>
              <div className={`w-10 h-14 rounded bg-gradient-to-br ${item.type === 'show' ? 'from-vault-teal/30 to-vault-teal/10' : 'from-vault-accent/30 to-vault-accent/10'} flex items-center justify-center shrink-0`}>
                <svg className="w-4 h-4 text-white/40" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-vault-text truncate group-hover:text-white">{item.title}</h4>
                <p className="text-xs text-vault-muted">{item.genre}</p>
              </div>
              <span className="text-xs text-vault-muted">{item.year}</span>
              <span className="text-xs text-vault-gold">★ {item.rating}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${item.type === 'show' ? 'bg-vault-teal/15 text-vault-teal' : 'bg-vault-accent/15 text-vault-accent'}`}>
                {item.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
