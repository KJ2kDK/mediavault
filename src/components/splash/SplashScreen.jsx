import { useEffect, useState } from 'react';

export default function SplashScreen({ onComplete, fading }) {
  const [phase, setPhase] = useState(0); // 0: logo, 1: tagline, 2: ready

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1200);
    const t2 = setTimeout(() => setPhase(2), 2200);
    const t3 = setTimeout(() => onComplete(), 3600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center splash-gradient transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Ambient glow rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-vault-accent/10 animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-vault-accent/20 animate-pulse" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full bg-vault-accent/5 animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Logo */}
      <div className={`relative transition-all duration-1000 ${phase >= 0 ? 'animate-logo-reveal' : 'opacity-0'}`}>
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="relative">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="8" width="56" height="48" rx="6" stroke="#e50914" strokeWidth="2.5" fill="none" />
              <path d="M24 22L42 32L24 42V22Z" fill="#e50914" />
              <rect x="8" y="4" width="48" height="4" rx="2" fill="#e50914" opacity="0.4" />
              <rect x="8" y="56" width="48" height="4" rx="2" fill="#e50914" opacity="0.4" />
            </svg>
            <div className="absolute inset-0 blur-xl bg-vault-accent/30 animate-pulse-glow rounded-full" />
          </div>
          {/* Title */}
          <h1 className="font-display text-6xl tracking-wider text-white">
            MEDIA<span className="text-vault-accent">VAULT</span>
          </h1>
        </div>
      </div>

      {/* Tagline */}
      <p
        className={`mt-6 text-vault-muted text-lg tracking-widest uppercase font-body transition-all duration-700 ${phase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      >
        Your Universe. One Interface.
      </p>

      {/* Loading bar */}
      <div
        className={`mt-10 w-48 h-0.5 bg-vault-border rounded-full overflow-hidden transition-all duration-500 ${phase >= 1 ? 'opacity-100' : 'opacity-0'}`}
      >
        <div
          className="h-full progress-bar rounded-full transition-all duration-[2000ms] ease-out"
          style={{ width: phase >= 2 ? '100%' : '0%' }}
        />
      </div>

      {/* Skip hint */}
      <button
        onClick={onComplete}
        className={`absolute bottom-8 text-vault-muted/50 text-sm hover:text-vault-muted transition-all duration-500 ${phase >= 1 ? 'opacity-100' : 'opacity-0'}`}
      >
        Press anywhere to skip
      </button>
    </div>
  );
}
