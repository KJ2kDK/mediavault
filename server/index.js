import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';
import qbitRoutes from './routes/qbittorrent.js';
import iptvRoutes, { scheduledIptvSync } from './routes/iptv.js';
import rssRoutes from './routes/rss.js';
import libraryRoutes from './routes/library.js';
import epgRoutes from './routes/epg.js';
import logsRoutes, { dbLog } from './routes/logs.js';
import subtitlesRoutes from './routes/subtitles.js';
import predbRoutes from './routes/predb.js';
import predbnetRoutes from './routes/predbnet.js';
import chatRoutes from './routes/chat.js';
import nordicbytesRoutes from './routes/nordicbytes.js';
import seedboxRoutes, { startAutoScan } from './routes/seedbox.js';
import adminRoutes from './routes/admin.js';
import argonRoutes from './routes/argon.js';
import { initPool as initSeedbox } from './services/seedbox.js';
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

// ── Media delivery routes — support token via query param (for <img> / HLS.js)
// These bypass the strict Bearer-header requirement since browsers can't add
// custom headers to <img src> or HLS.js manifest/segment requests.
// The requireAuth middleware now also checks ?token= query param.

// ── RSS ingest — public endpoint for browser-proxied Cloudflare feeds ────────
app.use('/api/rss-ingest', rssRoutes);

// ── Auth wall — all API routes below require a valid JWT ─────────────────────
app.use('/api', requireAuth);

// ── Protected API routes ─────────────────────────────────────────────────────
app.use('/api/qbit', qbitRoutes);
app.use('/api/qbittorrent', qbitRoutes); // alias — frontend uses this path
app.use('/api/iptv', iptvRoutes);
app.use('/api/rss', rssRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/epg', epgRoutes);
app.use('/api/subtitles', subtitlesRoutes);
app.use('/api/predb', predbRoutes);
app.use('/api/predbnet', predbnetRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/nordicbytes', nordicbytesRoutes);
app.use('/api/seedbox', seedboxRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/argon', argonRoutes);

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

app.listen(PORT, async () => {
  console.log(`MediaVault running on http://localhost:${PORT}`);

  // ── Initialize seedbox connection + auto-scan ──────────────────────────
  try {
    const connected = await initSeedbox();
    if (connected) {
      startAutoScan(10 * 60 * 1000); // Scan every 10 minutes
    }
  } catch (e) {
    console.warn(`[seedbox] Init skipped: ${e.message}`);
  }
});
