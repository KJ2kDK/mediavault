import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// Fetch and parse M3U from URL
router.get('/m3u', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const response = await fetch(url);
    const text = await response.text();
    const channels = parseM3U(text);
    res.json({ channels, count: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect to Xtream Codes API
router.post('/xtream', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    if (!base || !user || !pass) {
      return res.status(400).json({ error: 'All credentials required' });
    }

    const cleanBase = base.replace(/\/$/, '');

    // Get live streams
    const liveRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_live_streams`);
    const liveStreams = await liveRes.json();

    // Get categories
    const catRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_live_categories`);
    const categories = await catRes.json();

    const catMap = {};
    if (Array.isArray(categories)) {
      categories.forEach((c) => { catMap[c.category_id] = c.category_name; });
    }

    const channels = (Array.isArray(liveStreams) ? liveStreams : []).map((s, i) => ({
      id: `xtream_${s.stream_id || i}`,
      name: s.name || 'Unknown',
      group: catMap[s.category_id] || 'Uncategorized',
      logo: s.stream_icon || null,
      url: `${cleanBase}/live/${user}/${pass}/${s.stream_id}.m3u8`,
    }));

    res.json({ channels, count: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Xtream VOD
router.post('/xtream/vod', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const vodRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_vod_streams`);
    const vodStreams = await vodRes.json();

    const items = (Array.isArray(vodStreams) ? vodStreams : []).map((v, i) => ({
      id: `vod_${v.stream_id || i}`,
      title: v.name || 'Unknown',
      type: 'movie',
      year: v.year || null,
      rating: v.rating || null,
      genre: v.genre || '',
      thumb: v.stream_icon || null,
      url: `${cleanBase}/movie/${user}/${pass}/${v.stream_id}.mkv`,
    }));

    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Xtream Series
router.post('/xtream/series', async (req, res) => {
  try {
    const { base, user, pass } = req.body;
    const cleanBase = base.replace(/\/$/, '');
    const seriesRes = await fetch(`${cleanBase}/player_api.php?username=${user}&password=${pass}&action=get_series`);
    const series = await seriesRes.json();

    const items = (Array.isArray(series) ? series : []).map((s, i) => ({
      id: `series_${s.series_id || i}`,
      title: s.name || 'Unknown',
      type: 'show',
      year: s.year || null,
      rating: s.rating || null,
      genre: s.genre || '',
      thumb: s.cover || null,
    }));

    res.json({ items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const nameMatch = trimmed.match(/,(.+)$/);
      const groupMatch = trimmed.match(/group-title="([^"]*?)"/);
      const logoMatch = trimmed.match(/tvg-logo="([^"]*?)"/);
      const idMatch = trimmed.match(/tvg-id="([^"]*?)"/);
      current = {
        id: `m3u_${channels.length}`,
        tvgId: idMatch ? idMatch[1] : '',
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        logo: logoMatch ? logoMatch[1] : null,
        url: '',
      };
    } else if (trimmed && !trimmed.startsWith('#') && current) {
      current.url = trimmed;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

export default router;
