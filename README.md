# MediaVault

**Your Universe. One Interface.**

A unified personal media hub that brings together your Plex library, IPTV channels, news feeds, and torrent downloads into a sleek Netflix-style interface.

![MediaVault](https://img.shields.io/badge/version-0.1.0-red) ![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-%3E%3D18-green)

---

## Features

### 🎬 Plex Integration
- Browse your full Plex library with a Netflix-style UI
- Continue Watching, Recently Added, and genre-based carousels
- Hero banners with featured content
- Search across your entire library
- Direct playback via Plex player

### 📺 IPTV Player
- **M3U Playlist** — Upload `.m3u` files or load from URL
- **Xtream Codes** — Connect with server URL, username, and password
- Live TV with channel sidebar, group filtering, and search
- HLS.js-powered video playback
- Channel logos and EPG support (planned)

### 📰 News / RSS Reader
- Track multiple RSS feeds in one view
- Add/remove feeds dynamically
- Filter by source
- One-click "Send to Downloads" for torrent-linked items
- Auto-refresh with configurable intervals

### ⬇️ Download Manager (qBittorrent)
- Add torrents via magnet links or URLs
- Real-time progress tracking with speed/ETA
- Pause, resume, and delete torrents
- Custom save path per download
- Stats dashboard with active transfer counts

### ⚙️ Settings
- Configure all service connections in one place
- Test connections with instant feedback
- Persistent configuration via localStorage + `.env`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Node.js, Express |
| Fonts | Bebas Neue, DM Sans, JetBrains Mono |
| Streaming | HLS.js |
| APIs | Plex API, qBittorrent Web API, Xtream Codes API |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Plex Media Server (optional)
- qBittorrent with Web UI enabled (optional)
- IPTV subscription with M3U/Xtream credentials (optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mediavault.git
cd mediavault

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your service credentials
nano .env

# Start development (frontend + backend)
npm run dev:all
```

The app will be available at `http://localhost:3000`.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PLEX_SERVER_URL` | Your Plex server address | `http://192.168.1.100:32400` |
| `PLEX_TOKEN` | Plex authentication token | `xxxxxxxxxx` |
| `QBIT_URL` | qBittorrent Web UI address | `http://localhost:8080` |
| `QBIT_USERNAME` | qBittorrent username | `admin` |
| `QBIT_PASSWORD` | qBittorrent password | `adminadmin` |
| `QBIT_SAVE_PATH` | Default download directory | `/downloads/media` |
| `IPTV_M3U_URL` | M3U playlist URL (optional) | `http://example.com/playlist.m3u` |
| `XTREAM_BASE_URL` | Xtream Codes server URL | `http://example.com:8080` |
| `XTREAM_USERNAME` | Xtream username | `user123` |
| `XTREAM_PASSWORD` | Xtream password | `pass456` |

---

## Project Structure

```
mediavault/
├── public/                  # Static assets
├── src/
│   ├── components/
│   │   ├── splash/          # Splash screen
│   │   ├── layout/          # Sidebar, TopBar, MainLayout
│   │   └── common/          # MediaCard, CarouselRow, HeroBanner
│   ├── pages/
│   │   ├── HomePage.jsx     # Netflix-style home with carousels
│   │   ├── LibraryPage.jsx  # Full library grid/list browser
│   │   ├── LiveTVPage.jsx   # IPTV player + channel list
│   │   ├── NewsPage.jsx     # RSS reader with feed management
│   │   ├── DownloadsPage.jsx # qBittorrent download manager
│   │   └── SettingsPage.jsx # Service configuration
│   ├── hooks/
│   │   ├── useConfig.jsx    # App configuration context
│   │   └── usePlex.jsx      # Plex API hooks
│   ├── styles/
│   │   └── globals.css      # Tailwind + custom styles
│   ├── App.jsx
│   └── main.jsx
├── server/
│   ├── routes/
│   │   ├── plex.js          # Plex API proxy
│   │   ├── qbittorrent.js   # qBittorrent API proxy
│   │   ├── iptv.js          # M3U parser + Xtream Codes
│   │   └── rss.js           # RSS feed aggregator
│   └── index.js             # Express server entry
├── .env.example
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

---

## Development Roadmap

- [x] Phase 1: Splash screen + Netflix UI shell
- [x] Phase 2: Plex library integration
- [x] Phase 3: IPTV player (M3U + Xtream Codes)
- [x] Phase 4: RSS news reader
- [x] Phase 5: qBittorrent download manager
- [ ] Phase 6: EPG (Electronic Program Guide) for IPTV
- [ ] Phase 7: Plex web player embed
- [ ] Phase 8: RSS-to-torrent auto-download rules
- [ ] Phase 9: User authentication / profiles
- [ ] Phase 10: Mobile-responsive layout
- [ ] Phase 11: Docker deployment
- [ ] Phase 12: PWA support

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Plex](https://plex.tv) for the media server API
- [qBittorrent](https://qbittorrent.org) for the torrent client
- [HLS.js](https://github.com/video-dev/hls.js) for video streaming
- [Tailwind CSS](https://tailwindcss.com) for styling
