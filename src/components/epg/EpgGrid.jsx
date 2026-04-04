import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useEpg } from '../../hooks/useEpg.js';

const PX_PER_MIN = 4;   // 240px/hr — 5760px total for 24h
const ROW_H      = 52;  // channel row height (px)
const LEFT_W     = 180; // sticky channel-name column width (px)
const HEADER_H   = 40;  // sticky time-axis height (px)
const MIN_LABEL  = 60;  // min block width (px) before rendering title text

// Format epoch seconds as HH:MM in a specific timezone (defaults to UTC)
function fmtTz(epoch, tz) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleTimeString([], {
    timeZone: tz || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Get UTC offset in hours for a timezone at a given date
function getUtcOffsetHours(tz, date = new Date()) {
  const utcMs  = Date.parse(date.toLocaleString('en-CA', { timeZone: 'UTC',  hour12: false }));
  const tzMs   = Date.parse(date.toLocaleString('en-CA', { timeZone: tz,     hour12: false }));
  return (tzMs - utcMs) / 3_600_000;
}

// Get Unix seconds for midnight of today in the given timezone
function midnightInTz(tz) {
  const now = new Date();
  const [year, month, day] = now.toLocaleDateString('sv-SE', { timeZone: tz })
    .split('-').map(Number);
  const offset = getUtcOffsetHours(tz, now);
  return Date.UTC(year, month - 1, day) / 1000 - offset * 3600;
}

export default function EpgGrid({ channels, timezone, onClose }) {
  const { fetchSchedules } = useEpg();
  const scrollRef  = useRef(null);
  const [schedules, setSchedules] = useState({});
  const [loading, setLoading]     = useState(true);
  const [tooltip, setTooltip]     = useState(null); // {title, description, x, y}
  const [nowSec, setNowSec]       = useState(() => Math.floor(Date.now() / 1000));

  const tz = timezone || 'UTC';
  const DAY_START = useMemo(() => midnightInTz(tz), [tz]);
  const TOTAL_PX  = 24 * 60 * PX_PER_MIN; // 5760

  // ── Data: fetch once on mount ───────────────────────────────────────────
  useEffect(() => {
    const ids = channels.map(c => c.epg_id).filter(Boolean);
    fetchSchedules(ids).then(data => {
      setSchedules(data);
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to current time once data is ready ──────────────────────────
  useEffect(() => {
    if (!loading && scrollRef.current) {
      const nowPx  = (nowSec - DAY_START) / 60 * PX_PER_MIN;
      const vpW    = scrollRef.current.clientWidth - LEFT_W;
      scrollRef.current.scrollLeft = Math.max(0, nowPx - vpW * 0.3);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tick now-line every minute ──────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Escape key closes ───────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Time ticks every 30 min
  const timeTicks = useMemo(() => {
    const ticks = [];
    for (let m = 0; m < 24 * 60; m += 30) {
      ticks.push({ left: m * PX_PER_MIN, label: fmtTz(DAY_START + m * 60, tz) });
    }
    return ticks;
  }, [DAY_START]);

  const nowPx = (nowSec - DAY_START) / 60 * PX_PER_MIN;

  const handleProgClick = useCallback((e, prog) => {
    e.stopPropagation();
    const x = Math.min(e.clientX + 14, window.innerWidth - 292);
    const y = e.clientY + 14 + 120 > window.innerHeight
      ? e.clientY - 130
      : e.clientY + 14;
    setTooltip({ title: prog.title, description: prog.description, x, y });
  }, []);

  const groupName = channels[0]?.group ?? '';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-vault-bg text-vault-text animate-fade-in">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-vault-card border-b border-vault-border shrink-0">
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-vault-muted hover:text-vault-text hover:bg-vault-border/50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="w-px h-4 bg-vault-border" />
        <svg className="w-4 h-4 text-vault-teal shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="font-semibold text-sm">Programme Guide</span>
        {groupName && <span className="text-xs text-vault-muted">— {groupName}</span>}
        <span className="ml-auto text-xs text-vault-muted">{channels.length} channels</span>
        <span className="text-vault-muted/40 text-xs">·</span>
        <span className="text-xs text-vault-teal font-medium">{fmtTz(nowSec, tz)}</span>
      </div>

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3 text-vault-muted">
          <div className="w-5 h-5 border-2 border-vault-teal/30 border-t-vault-teal rounded-full animate-spin" />
          <span className="text-sm">Loading programme guide…</span>
        </div>
      ) : (

        /* ── Dual-axis scroll container ─────────────────────────────────── */
        <div ref={scrollRef} className="flex-1 overflow-auto" style={{ position: 'relative' }}>

          {/* Inner content — wide enough to force horizontal scroll */}
          <div style={{ minWidth: LEFT_W + TOTAL_PX }}>

            {/* ── Sticky header row (top-left corner + time axis) ────────── */}
            <div
              className="flex sticky top-0 z-20"
              style={{ height: HEADER_H }}
            >
              {/* Top-left corner: sticky left AND top */}
              <div
                className="sticky left-0 z-30 bg-vault-card border-b border-r border-vault-border shrink-0"
                style={{ width: LEFT_W, height: HEADER_H }}
              />

              {/* Time axis */}
              <div
                className="relative bg-vault-surface border-b border-vault-border shrink-0"
                style={{ width: TOTAL_PX, height: HEADER_H }}
              >
                {timeTicks.map(tick => (
                  <span
                    key={tick.left}
                    className="absolute top-0 bottom-0 flex items-center text-[10px] text-vault-muted px-1.5 border-l border-vault-border/25 whitespace-nowrap"
                    style={{ left: tick.left }}
                  >
                    {tick.label}
                  </span>
                ))}
                {/* Now indicator on time axis */}
                {nowPx >= 0 && nowPx <= TOTAL_PX && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-vault-accent z-10 pointer-events-none"
                    style={{ left: nowPx }}
                  />
                )}
              </div>
            </div>

            {/* ── Channel rows ─────────────────────────────────────────── */}
            {channels.map(channel => {
              const progs  = channel.epg_id ? (schedules[channel.epg_id] ?? []) : [];
              const hasEpg = channel.epg_id != null && progs.length > 0;

              return (
                <div key={channel.id} className="flex" style={{ height: ROW_H }}>

                  {/* Sticky left: channel info */}
                  <div
                    className="sticky left-0 z-10 shrink-0 flex items-center gap-2 px-2 bg-vault-card border-b border-r border-vault-border"
                    style={{ width: LEFT_W, height: ROW_H }}
                  >
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt=""
                        className="w-8 h-8 object-contain rounded shrink-0"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-vault-border/30 shrink-0 flex items-center justify-center">
                        <svg className="w-4 h-4 text-vault-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                      </div>
                    )}
                    <span className="text-[11px] text-vault-text leading-tight line-clamp-2 min-w-0">
                      {channel.name}
                    </span>
                  </div>

                  {/* Programme blocks */}
                  <div
                    className="relative shrink-0 border-b border-vault-border/40"
                    style={{ width: TOTAL_PX, height: ROW_H }}
                  >
                    {/* 30-min grid lines */}
                    {timeTicks.map(tick => (
                      <div
                        key={tick.left}
                        className="absolute top-0 bottom-0 w-px bg-vault-border/12 pointer-events-none"
                        style={{ left: tick.left }}
                      />
                    ))}

                    {/* Now line across rows */}
                    {nowPx >= 0 && nowPx <= TOTAL_PX && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-vault-accent/50 z-10 pointer-events-none"
                        style={{ left: nowPx }}
                      />
                    )}

                    {hasEpg ? progs.map((prog, i) => {
                      const blockLeft  = Math.max(0, (prog.start - DAY_START) / 60 * PX_PER_MIN);
                      const blockRight = (prog.stop - DAY_START) / 60 * PX_PER_MIN;
                      const blockW     = Math.max(2, blockRight - blockLeft - 2);
                      const isNow      = nowSec >= prog.start && nowSec < prog.stop;
                      const progress   = isNow
                        ? Math.max(0, Math.min(100, ((nowSec - prog.start) / (prog.stop - prog.start)) * 100))
                        : 0;

                      return (
                        <div
                          key={i}
                          className={`absolute top-1.5 bottom-1.5 rounded overflow-hidden cursor-pointer border transition-colors
                            ${isNow
                              ? 'bg-vault-accent/20 border-vault-accent/50 hover:bg-vault-accent/30'
                              : 'bg-vault-card/80 border-vault-border/50 hover:bg-vault-card hover:border-vault-border'
                            }`}
                          style={{ left: blockLeft, width: blockW }}
                          onClick={e => handleProgClick(e, prog)}
                        >
                          {blockW >= MIN_LABEL && (
                            <div className="px-1.5 h-full flex flex-col justify-center">
                              <p className={`text-[10px] font-medium truncate leading-tight ${isNow ? 'text-white' : 'text-vault-text'}`}>
                                {prog.title}
                              </p>
                              {blockW >= 130 && (
                                <p className="text-[9px] text-vault-muted truncate leading-tight mt-0.5">
                                  {fmtTz(prog.start, tz)}–{fmtTz(prog.stop, tz)}
                                </p>
                              )}
                            </div>
                          )}
                          {isNow && (
                            <div
                              className="absolute bottom-0 left-0 h-0.5 bg-vault-accent"
                              style={{ width: `${progress}%` }}
                            />
                          )}
                        </div>
                      );
                    }) : (
                      <div className="absolute inset-x-0 top-1.5 bottom-1.5 mx-1 rounded bg-vault-border/10 flex items-center px-3">
                        <span className="text-[10px] text-vault-muted/35">No EPG data</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tooltip ───────────────────────────────────────────────────────── */}
      {tooltip && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTooltip(null)} />
          <div
            className="fixed z-50 bg-vault-card border border-vault-border rounded-lg shadow-2xl p-3 w-72 pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <p className="text-xs font-semibold text-vault-text mb-1 leading-snug">{tooltip.title}</p>
            {tooltip.description
              ? <p className="text-[10px] text-vault-muted leading-snug line-clamp-5">{tooltip.description}</p>
              : <p className="text-[10px] text-vault-muted/40 italic">No description available</p>
            }
            <p className="text-[9px] text-vault-muted/40 mt-2">click anywhere to dismiss</p>
          </div>
        </>
      )}
    </div>
  );
}
