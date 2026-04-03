import HeroBanner from '../components/common/HeroBanner';
import CarouselRow from '../components/common/CarouselRow';
import { usePlexLibrary } from '../hooks/usePlex';

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

export default function HomePage({ searchQuery }) {
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

      {Object.entries(rows).map(([title, items]) => (
        <CarouselRow key={title} title={title} items={items} />
      ))}
    </div>
  );
}
