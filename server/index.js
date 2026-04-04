import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import plexRoutes from './routes/plex.js';
import qbitRoutes from './routes/qbittorrent.js';
import iptvRoutes, { scheduledIptvSync } from './routes/iptv.js';
import rssRoutes from './routes/rss.js';
import libraryRoutes from './routes/library.js';
import epgRoutes from './routes/epg.js';
import logsRoutes, { dbLog } from './routes/logs.js';
import subtitlesRoutes from './routes/subtitles.js';
import db from './db/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/plex', plexRoutes);
app.use('/api/qbit', qbitRoutes);
app.use('/api/iptv', iptvRoutes);
app.use('/api/rss', rssRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epg', epgRoutes);
app.use('/api/subtitles', subtitlesRoutes);
app.use('/api/logs', logsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// ── Daily IPTV auto-refresh (checks every 30 min, syncs if > 23h old) ─────────
setInterval(() => {
  try {
    const meta = db.prepare("SELECT value FROM iptv_meta WHERE key='last_sync_at'").get();
    if (!meta) return;
    const age = Math.floor(Date.now() / 1000) - Number(meta.value);
    if (age < 82800) return; // 23h — not due yet
    scheduledIptvSync();
  } catch (err) {
    dbLog('error', 'server/auto-sync', err.message, { stack: err.stack });
  }
}, 30 * 60 * 1000); // 30-minute check interval

// Global error handler — catches any unhandled route errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  dbLog('error', `${req.method} ${req.path}`, err.message, { stack: err.stack });
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`MediaVault API running on http://localhost:${PORT}`);
});
