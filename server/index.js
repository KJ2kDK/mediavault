import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import plexRoutes from './routes/plex.js';
import qbitRoutes from './routes/qbittorrent.js';
import iptvRoutes, { scheduledIptvSync } from './routes/iptv.js';
import rssRoutes from './routes/rss.js';
import libraryRoutes from './routes/library.js';
import epgRoutes from './routes/epg.js';
import logsRoutes, { dbLog } from './routes/logs.js';
import subtitlesRoutes from './routes/subtitles.js';
import predbRoutes from './routes/predb.js';
import predbnetRoutes from './routes/predbnet.js';
import db from './db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Static files (production build) ──────────────────────────────────────────
app.use(express.static(join(__dirname, '../dist')));

// ── Public routes (no auth required) ─────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// ── Auth wall — all API routes below require a valid JWT ─────────────────────
app.use('/api', requireAuth);

// ── Protected API routes ─────────────────────────────────────────────────────
app.use('/api/plex', plexRoutes);
app.use('/api/qbit', qbitRoutes);
app.use('/api/iptv', iptvRoutes);
app.use('/api/rss', rssRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epg', epgRoutes);
app.use('/api/subtitles', subtitlesRoutes);
app.use('/api/predb', predbRoutes);
app.use('/api/predbnet', predbnetRoutes);
app.use('/api/logs', logsRoutes);

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

// ── SPA catch-all (serve index.html for client-side routing) ─────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`MediaVault running on http://localhost:${PORT}`);
});
