import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

const plexFetch = async (path, token, serverUrl) => {
  const url = `${serverUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      'X-Plex-Token': token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Plex API error: ${res.status}`);
  return res.json();
};

// Test connection
router.get('/test', async (req, res) => {
  try {
    const serverUrl = process.env.PLEX_SERVER_URL;
    const token = process.env.PLEX_TOKEN;
    if (!serverUrl || !token) return res.json({ success: false, error: 'Not configured' });

    const data = await plexFetch('/', token, serverUrl);
    res.json({
      success: true,
      serverName: data.MediaContainer?.friendlyName || 'Plex Server',
      version: data.MediaContainer?.version,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get all libraries
router.get('/libraries', async (req, res) => {
  try {
    const serverUrl = process.env.PLEX_SERVER_URL;
    const token = process.env.PLEX_TOKEN;
    const data = await plexFetch('/library/sections', token, serverUrl);
    const sections = (data.MediaContainer?.Directory || []).map((d) => ({
      id: d.key,
      title: d.title,
      type: d.type,
      count: d.count || 0,
    }));
    res.json({ sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get library contents organized for the Netflix UI
router.get('/library', async (req, res) => {
  try {
    const serverUrl = process.env.PLEX_SERVER_URL;
    const token = process.env.PLEX_TOKEN;
    if (!serverUrl || !token) return res.json(null);

    // Fetch library sections
    const sectionsData = await plexFetch('/library/sections', token, serverUrl);
    const sections = sectionsData.MediaContainer?.Directory || [];

    const library = {};

    for (const section of sections) {
      // Recently added
      try {
        const recent = await plexFetch(`/library/sections/${section.key}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=15`, token, serverUrl);
        const items = (recent.MediaContainer?.Metadata || []).map(mapPlexItem);
        if (items.length > 0) {
          library[`Recently Added — ${section.title}`] = items;
        }
      } catch {}

      // On deck (continue watching)
      try {
        const onDeck = await plexFetch(`/library/sections/${section.key}/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=15`, token, serverUrl);
        const items = (onDeck.MediaContainer?.Metadata || []).map(mapPlexItem);
        if (items.length > 0) {
          library['Continue Watching'] = items;
        }
      } catch {}
    }

    // Global on deck
    try {
      const globalDeck = await plexFetch('/library/onDeck', token, serverUrl);
      const items = (globalDeck.MediaContainer?.Metadata || []).map(mapPlexItem);
      if (items.length > 0) {
        library['Continue Watching'] = items;
      }
    } catch {}

    res.json(library);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const serverUrl = process.env.PLEX_SERVER_URL;
    const token = process.env.PLEX_TOKEN;
    const data = await plexFetch(`/hubs/search?query=${encodeURIComponent(q)}&limit=20`, token, serverUrl);
    const results = [];
    for (const hub of data.MediaContainer?.Hub || []) {
      for (const item of hub.Metadata || []) {
        results.push(mapPlexItem(item));
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapPlexItem(item) {
  const serverUrl = process.env.PLEX_SERVER_URL;
  const token = process.env.PLEX_TOKEN;
  return {
    id: item.ratingKey,
    title: item.title,
    year: item.year,
    rating: item.audienceRating || item.rating || null,
    type: item.type === 'show' || item.type === 'season' || item.type === 'episode' ? 'show' : 'movie',
    genre: item.Genre?.[0]?.tag || '',
    thumb: item.thumb ? `${serverUrl}${item.thumb}?X-Plex-Token=${token}` : null,
    progress: item.viewOffset ? Math.round((item.viewOffset / (item.duration || 1)) * 100) : 0,
    episode: item.type === 'episode' ? `S${String(item.parentIndex).padStart(2, '0')}E${String(item.index).padStart(2, '0')}` : null,
    description: item.summary || '',
  };
}

export default router;
