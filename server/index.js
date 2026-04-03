import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import plexRoutes from './routes/plex.js';
import qbitRoutes from './routes/qbittorrent.js';
import iptvRoutes from './routes/iptv.js';
import rssRoutes from './routes/rss.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/plex', plexRoutes);
app.use('/api/qbit', qbitRoutes);
app.use('/api/iptv', iptvRoutes);
app.use('/api/rss', rssRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`MediaVault API running on http://localhost:${PORT}`);
});
