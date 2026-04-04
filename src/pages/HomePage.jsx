import HeroBanner from '../components/common/HeroBanner';
import CarouselRow from '../components/common/CarouselRow';
import { usePlexLibrary } from '../hooks/usePlex';
import { useBookmarks } from '../hooks/useBookmarks';

// Demo data — replaced by Plex API data when connected
const DEMO_FEATURED = [
  { id: 'f1', title: 'Dune: Part Two', year: 2024, rating: '8.6', type: 'movie', genre: 'Sci-Fi', description: 'Paul Atreides unites with the Fremen while on a warpath of revenge against the conspirators who destroyed his family.' },
  { id: 'f2', title: 'Shogun', year: 2024, rating: '8.7', type: 'show', genre: 'Drama', description: 'In feudal Japan, an English sailor becomes embroiled in a deadly power struggle between warring factions.' },
  { id: 'f3', title: 'Fallout', year: 2024, rating: '8.5', type: 'show', genre: 'Sci-Fi', description: 'In a post-nuclear Los Angeles, inhabitants of luxury fallout shelters are forced to return to the ruined world above.' },
];

const DEMO_ROWS = {
  'Continue Watching': [
    { id: 1, title: 'Dune: Part Two', year: 2024, rating: '8.6', type: 'movie', progress: 65, genre: 'Sci-Fi' },
    { id: 2, title: 'Shogun', year: 2024, rating: '8.7', type: 'show', progress: 30, episode: 'S01E05', genre: 'Drama' },
    { id: 3, title: '3 Body Problem', year: 2024, rating: '7.5', type: 'show', progress: 80, episode: 'S01E08', genre: 'Sci-Fi' },
    { id: 4, title: 'Civil War', year: 2024, rating: '7.0', type: 'movie', progress: 20, genre: 'Action' },
    { id: 5, title: 'Ripley', year: 2024, rating: '7.8', type: 'show', progress: 55, episode: 'S01E03', genre: 'Thriller' },
  ],
  'Recently Added': [
    { id: 10, title: 'Fallout', year: 2024, rating: '8.5', type: 'show', genre: 'Sci-Fi' },
    { id: 11, title: 'Monkey Man', year: 2024, rating: '6.9', type: 'movie', genre: 'Action' },
    { id: 12, title: 'The Gentlemen', year: 2024, rating: '7.8', type: 'show', genre: 'Comedy' },
    { id: 13, title: 'Godzilla x Kong', year: 2024, rating: '6.5', type: 'movie', genre: 'Action' },
    { id: 14, title: 'Baby Reindeer', year: 2024, rating: '7.6', type: 'show', genre: 'Drama' },
    { id: 15, title: 'Challengers', year: 2024, rating: '7.8', type: 'movie', genre: 'Drama' },
  ],
  'Top Rated Movies': [
    { id: 20, title: 'Oppenheimer', year: 2023, rating: '8.3', type: 'movie', genre: 'Drama' },
    { id: 21, title: 'Past Lives', year: 2023, rating: '7.8', type: 'movie', genre: 'Drama' },
    { id: 22, title: 'The Zone of Interest', year: 2023, rating: '7.4', type: 'movie', genre: 'Drama' },
    { id: 23, title: 'Poor Things', year: 2023, rating: '7.9', type: 'movie', genre: 'Comedy' },
    { id: 24, title: 'Anatomy of a Fall', year: 2023, rating: '7.7', type: 'movie', genre: 'Thriller' },
    { id: 25, title: 'Killers of the Flower Moon', year: 2023, rating: '7.6', type: 'movie', genre: 'Drama' },
  ],
  'Binge-Worthy Series': [
    { id: 30, title: 'True Detective: Night Country', year: 2024, rating: '6.2', type: 'show', genre: 'Thriller' },
    { id: 31, title: 'Mr. & Mrs. Smith', year: 2024, rating: '6.7', type: 'show', genre: 'Action' },
    { id: 32, title: 'Hacks', year: 2024, rating: '8.0', type: 'show', genre: 'Comedy' },
    { id: 33, title: 'Slow Horses', year: 2024, rating: '7.7', type: 'show', genre: 'Thriller' },
    { id: 34, title: 'Reacher', year: 2024, rating: '8.1', type: 'show', genre: 'Action' },
  ],
};

function BookmarkedChannels({ onNavigate }) {
  const { bookmarks } = useBookmarks('channel');
  if (bookmarks.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 px-6 mb-3">
        <h3 className="font-display text-xl tracking-wide text-white">My Channels</h3>
        <span className="text-[10px] text-vault-gold bg-vault-gold/15 px-2 py-0.5 rounded-full font-medium">
          {bookmarks.length} bookmarked
        </span>
      </div>
      <div className="flex gap-3 px-6 overflow-x-auto carousel-row pb-2">
        {bookmarks.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onNavigate('livetv', ch)}
            className="shrink-0 w-36 flex flex-col items-center gap-2 p-3 rounded-xl bg-vault-surface border border-vault-border hover:border-vault-accent/50 hover:bg-vault-card transition-all group"
          >
            <div className="w-14 h-14 rounded-lg bg-vault-card flex items-center justify-center overflow-hidden">
              {ch.logo ? (
                <img src={ch.logo} alt="" className="w-12 h-12 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <svg className="w-7 h-7 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div className="text-center min-w-0 w-full">
              <p className="text-xs font-medium text-vault-text truncate">{ch.title ?? ch.name}</p>
              <p className="text-[10px] text-vault-muted truncate">{ch.group_name}</p>
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-vault-accent opacity-0 group-hover:opacity-100 transition-opacity">
              Watch →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HomePage({ searchQuery, onNavigate }) {
  const { library, connected } = usePlexLibrary();
  const rows = connected && library ? library : DEMO_ROWS;

  return (
    <div className="animate-fade-in">
      <HeroBanner items={DEMO_FEATURED} />

      {!connected && (
        <div className="mx-6 mb-6 px-4 py-3 rounded-lg bg-vault-card border border-vault-border flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-vault-gold animate-pulse" />
          <p className="text-sm text-vault-muted">
            Showing demo content — connect your Plex server in <span className="text-vault-teal">Settings</span> to browse your library.
          </p>
        </div>
      )}

      <BookmarkedChannels onNavigate={onNavigate} />

      {Object.entries(rows).map(([title, items]) => (
        <CarouselRow key={title} title={title} items={items} />
      ))}
    </div>
  );
}
