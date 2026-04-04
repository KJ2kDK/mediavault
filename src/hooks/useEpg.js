import { useState, useEffect, useCallback } from 'react';

// Module-level cache — shared across all hook instances
const nowCache = {};   // epgId → { now, next }
const listeners = new Set();
let statusCache = null;

function notify() {
  listeners.forEach((fn) => fn());
}

// Call after epg_ids change (e.g. auto-match) so stale cache entries don't block re-fetch
export function clearNowCache() {
  for (const key of Object.keys(nowCache)) delete nowCache[key];
  notify();
}

export function useEpg() {
  const [, tick] = useState(0);
  const [status, setStatus] = useState(statusCache);

  useEffect(() => {
    const refresh = () => tick((n) => n + 1);
    listeners.add(refresh);
    return () => listeners.delete(refresh);
  }, []);

  // Check EPG DB status (count + last fetch time)
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/epg/status');
      const data = await res.json();
      statusCache = data;
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Fetch now/next for a list of epg_ids — skips already-cached ids, batches to avoid huge URLs
  const fetchNow = useCallback(async (epgIds) => {
    const needed = epgIds.filter((id) => id && !(id in nowCache));
    if (!needed.length) return;
    const BATCH = 100;
    for (let i = 0; i < needed.length; i += BATCH) {
      const batch = needed.slice(i, i + BATCH);
      try {
        const res = await fetch(`/api/epg/now?ids=${encodeURIComponent(batch.join(','))}`);
        const data = await res.json();
        Object.assign(nowCache, data.epg ?? {});
      } catch { /* silent — EPG is optional */ }
    }
    notify();
  }, []);

  // Refresh now/next for ids already in cache (e.g. every 60 s to pick up programme changes)
  const refreshNow = useCallback(async (epgIds) => {
    const valid = epgIds.filter(Boolean);
    if (!valid.length) return;
    const BATCH = 100;
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH);
      try {
        const res = await fetch(`/api/epg/now?ids=${encodeURIComponent(batch.join(','))}`);
        const data = await res.json();
        Object.assign(nowCache, data.epg ?? {});
      } catch { /* silent */ }
    }
    notify();
  }, []);

  // Get current/next programme for a single channel (from cache)
  const getEpg = useCallback((epgId) => {
    if (!epgId) return null;
    return nowCache[epgId] ?? null;
  }, []);

  // Trigger a full XMLTV fetch in the background
  const triggerFetch = useCallback(async (creds) => {
    const res = await fetch('/api/epg/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    return res.json();
  }, []);

  // Fetch full day schedule for one channel
  const getSchedule = useCallback(async (epgId) => {
    if (!epgId) return [];
    const res = await fetch(`/api/epg/schedule?id=${encodeURIComponent(epgId)}`);
    const data = await res.json();
    return data.programmes ?? [];
  }, []);

  // Batch-fetch full schedules for multiple channels — used by EpgGrid
  const fetchSchedules = useCallback(async (epgIds) => {
    const valid = epgIds.filter(Boolean);
    if (!valid.length) return {};
    const BATCH = 200;
    const allProgrammes = [];
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH);
      try {
        const res = await fetch(`/api/epg/schedules?ids=${encodeURIComponent(batch.join(','))}`);
        const data = await res.json();
        if (Array.isArray(data.programmes)) allProgrammes.push(...data.programmes);
      } catch { /* silent */ }
    }
    const byChannel = {};
    for (const prog of allProgrammes) {
      if (!byChannel[prog.channel_id]) byChannel[prog.channel_id] = [];
      byChannel[prog.channel_id].push(prog);
    }
    return byChannel;
  }, []);

  return { status, checkStatus, fetchNow, refreshNow, getEpg, triggerFetch, getSchedule, fetchSchedules };
}

// Format unix epoch → "HH:MM"
export function fmtTime(epoch) {
  if (!epoch) return '';
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Progress 0-100 within current programme
export function epgProgress(prog) {
  if (!prog) return 0;
  const now = Date.now() / 1000;
  const pct = ((now - prog.start) / (prog.stop - prog.start)) * 100;
  return Math.max(0, Math.min(100, pct));
}
