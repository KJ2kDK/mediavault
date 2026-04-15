/**
 * qBittorrent completion watcher.
 *
 * Polls qBit every 60 seconds and triggers a seedbox library rescan when
 * a torrent transitions from "not completed" to "completed" (progress === 1).
 * That way new downloads appear in MediaVault's library without waiting for
 * the 10-minute auto-scan.
 *
 * State is in-memory (a Set of known-completed torrent hashes). On startup
 * we seed the set from the current qBit state so we don't rescan for every
 * torrent that's already done; only NEW completions trigger a rescan.
 */

import { qbitFetch } from '../routes/qbittorrent.js';

let pollInterval = null;
const completedHashes = new Set();
let primed = false;

async function poll(refreshLibrary) {
  try {
    const res = await qbitFetch('/api/v2/torrents/info');
    if (!res.ok) return;
    const torrents = await res.json();
    const nowCompleted = torrents
      .filter((t) => t.progress === 1)
      .map((t) => t.hash);

    if (!primed) {
      // First run after boot — seed the set so we don't fire a rescan for
      // every torrent that was already complete before we started watching.
      nowCompleted.forEach((h) => completedHashes.add(h));
      primed = true;
      console.log(`[qbit-watcher] primed with ${completedHashes.size} completed torrents`);
      return;
    }

    const newlyCompleted = nowCompleted.filter((h) => !completedHashes.has(h));
    if (newlyCompleted.length > 0) {
      console.log(`[qbit-watcher] ${newlyCompleted.length} new completion(s) — triggering seedbox rescan`);
      newlyCompleted.forEach((h) => completedHashes.add(h));
      try {
        await refreshLibrary();
      } catch (e) {
        console.warn('[qbit-watcher] seedbox rescan failed:', e.message);
      }
    }

    // Prune hashes that no longer exist (torrent was removed from qBit)
    const currentSet = new Set(torrents.map((t) => t.hash));
    for (const h of completedHashes) if (!currentSet.has(h)) completedHashes.delete(h);
  } catch (err) {
    // qBit offline or credentials wrong — silently retry next tick
  }
}

/**
 * Start the watcher. refreshLibrary is the seedbox rescan function.
 * Safe to call multiple times; restarts the timer.
 */
export function startQbitWatcher(refreshLibrary, intervalMs = 60_000) {
  if (pollInterval) clearInterval(pollInterval);
  if (!process.env.QBIT_URL) {
    console.log('[qbit-watcher] disabled — QBIT_URL not set');
    return;
  }
  // Prime immediately on startup
  poll(refreshLibrary);
  pollInterval = setInterval(() => poll(refreshLibrary), intervalMs);
  console.log(`[qbit-watcher] enabled — polling every ${intervalMs / 1000}s`);
}

export function stopQbitWatcher() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
