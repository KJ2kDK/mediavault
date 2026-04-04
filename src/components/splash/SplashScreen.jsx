import { useEffect, useState } from 'react';
import { setChannelCache } from '../../hooks/useChannels';

// Each step: fn() must return true | false | { ok: boolean, detail?: string }
const BOOT_STEPS = [
  {
    label: 'Initializing core services',
    fn: () => fetch('/api/health').then((r) => r.ok).catch(() => false),
  },
  {
    label: 'Loading your configuration',
    fn: () => new Promise((r) => setTimeout(() => r(true), 300)),
  },
  {
    label: 'Connecting to media library',
    fn: () => fetch('/api/library/bookmarks?type=channel').then((r) => r.ok).catch(() => false),
  },
  {
    label: 'Loading channels & playlist',
    fn: async () => {
      try {
        const res = await fetch('/api/iptv/preload');
        if (!res.ok) return { ok: true, detail: 'no playlist yet' };
        const data = await res.json();
        if (data.channels?.length > 0) setChannelCache(data.channels);
        const n = data.channels?.length ?? 0;
        const detail = n > 0 ? `${n.toLocaleString()} channels` : 'no playlist yet';
        return { ok: true, detail };
      } catch {
        return { ok: false };
      }
    },
  },
  {
    label: 'Warming up the player',
    fn: () => new Promise((r) => setTimeout(() => r(true), 250)),
  },
];

export default function SplashScreen({ onComplete, fading }) {
  const [logoVisible, setLogoVisible] = useState(false);
  const [stepsVisible, setStepsVisible] = useState(false);
  // Each entry: { status: 'pending'|'running'|'ok'|'warn', detail: string|null }
  const [stepStates, setStepStates] = useState(BOOT_STEPS.map(() => ({ status: 'pending', detail: null })));
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLogoVisible(true), 200);
    const t2 = setTimeout(async () => {
      setStepsVisible(true);
      const states = BOOT_STEPS.map(() => ({ status: 'pending', detail: null }));
      setStepStates([...states]);

      for (let i = 0; i < BOOT_STEPS.length; i++) {
        states[i] = { status: 'running', detail: null };
        setStepStates([...states]);

        const raw = await BOOT_STEPS[i].fn().catch(() => false);
        const ok = raw === true || raw?.ok === true;
        const detail = raw?.detail ?? null;
        states[i] = { status: ok ? 'ok' : 'warn', detail };
        setStepStates([...states]);

        await new Promise((r) => setTimeout(r, 160));
      }

      setAllDone(true);
      setTimeout(() => onComplete(), 1200);
    }, 800);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center splash-gradient transition-opacity duration-600 ${fading ? 'opacity-0' : 'opacity-100'}`}
      onClick={allDone ? onComplete : undefined}
    >
      {/* Ambient glow rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-vault-accent/10 animate-pulse" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-vault-accent/20 animate-pulse" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] rounded-full bg-vault-accent/5 animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Logo */}
      <div className={`relative transition-all duration-700 ${logoVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
        <div className="flex items-center gap-4">
          <div className="relative">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="8" width="56" height="48" rx="6" stroke="#e50914" strokeWidth="2.5" fill="none" />
              <path d="M24 22L42 32L24 42V22Z" fill="#e50914" />
              <rect x="8" y="4" width="48" height="4" rx="2" fill="#e50914" opacity="0.4" />
              <rect x="8" y="56" width="48" height="4" rx="2" fill="#e50914" opacity="0.4" />
            </svg>
            <div className="absolute inset-0 blur-xl bg-vault-accent/30 animate-pulse-glow rounded-full" />
          </div>
          <h1 className="font-display text-6xl tracking-wider text-white">
            MEDIA<span className="text-vault-accent">VAULT</span>
          </h1>
        </div>
        <p className="mt-3 text-vault-muted text-sm tracking-widest uppercase text-center font-body">
          Your Universe. One Interface.
        </p>
      </div>

      {/* Boot log */}
      <div className={`mt-10 w-96 transition-all duration-500 ${stepsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="rounded-lg border border-vault-border bg-black/40 backdrop-blur-sm p-4 font-mono text-xs space-y-2">
          {BOOT_STEPS.map((step, i) => {
            const { status, detail } = stepStates[i] ?? { status: 'pending', detail: null };
            return (
              <div key={step.label} className={`flex items-center gap-3 transition-all duration-300 ${status === 'pending' ? 'opacity-25' : 'opacity-100'}`}>
                {/* Status icon */}
                <span className="shrink-0 w-4 text-center">
                  {status === 'pending' && <span className="text-vault-muted">·</span>}
                  {status === 'running' && (
                    <span className="inline-block w-3 h-3 rounded-full border border-vault-teal border-t-transparent animate-spin" />
                  )}
                  {status === 'ok'   && <span className="text-green-400">✓</span>}
                  {status === 'warn' && <span className="text-vault-gold">⚠</span>}
                </span>
                <span className={`flex-1 ${status === 'running' ? 'text-white' : status === 'ok' ? 'text-vault-muted' : status === 'warn' ? 'text-vault-gold/70' : 'text-vault-muted/40'}`}>
                  {step.label}
                  {status === 'running' && <span className="animate-pulse">...</span>}
                  {status === 'ok' && (
                    <>
                      <span className="text-green-400/60 ml-2">OK</span>
                      {detail && <span className="text-vault-teal/70 ml-1">— {detail}</span>}
                    </>
                  )}
                  {status === 'warn' && <span className="text-vault-gold/60 ml-2">offline</span>}
                </span>
              </div>
            );
          })}

          {/* Ready banner */}
          {allDone && (
            <div className="mt-3 pt-3 border-t border-vault-border flex items-center gap-2 text-green-400 animate-fade-in">
              <span className="text-green-400">▶</span>
              <span className="tracking-wider">System ready. Welcome back.</span>
            </div>
          )}
        </div>
      </div>

      {/* Skip hint */}
      {allDone && (
        <button
          onClick={onComplete}
          className="absolute bottom-8 text-vault-muted/50 text-sm hover:text-vault-muted transition-colors animate-fade-in"
        >
          Click anywhere to continue
        </button>
      )}
    </div>
  );
}
