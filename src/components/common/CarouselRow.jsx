import { useRef, useState, useEffect } from 'react';
import MediaCard from './MediaCard';

export default function CarouselRow({ title, items, cardSize = 'md', onPlay, onMatched }) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    el?.addEventListener('scroll', checkScroll);
    return () => el?.removeEventListener('scroll', checkScroll);
  }, [items]);

  const scroll = (dir) => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="mb-8 group/row">
      <h3 className="font-display text-xl tracking-wide text-white px-6 mb-3">
        {title}
      </h3>
      <div className="relative">
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll(-1)}
            className="absolute left-0 top-0 bottom-0 w-12 z-10 bg-gradient-to-r from-vault-bg/90 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Cards */}
        <div
          ref={scrollRef}
          className="carousel-row flex gap-3 px-6 overflow-x-auto pb-2"
        >
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              size={cardSize}
              onPlay={onPlay}
              onMatched={onMatched}
            />
          ))}
        </div>

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll(1)}
            className="absolute right-0 top-0 bottom-0 w-12 z-10 bg-gradient-to-l from-vault-bg/90 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
