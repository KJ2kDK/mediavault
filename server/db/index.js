import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = process.env.MEDIAVAULT_DB_DIR || __dirname;
mkdirSync(dbDir, { recursive: true });

const db = new Database(join(dbDir, 'mediavault.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('channel','vod','series')),
    title       TEXT    NOT NULL,
    logo        TEXT,
    thumb       TEXT,
    group_name  TEXT,
    category_id TEXT,
    url         TEXT,
    year        INTEGER,
    rating      TEXT,
    added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (id, type)
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('channel','vod','series')),
    title       TEXT,
    thumb       TEXT,
    progress    REAL    NOT NULL DEFAULT 0,
    duration    INTEGER,
    watched_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_history_item
    ON watch_history(item_id, type);

  CREATE TABLE IF NOT EXISTS custom_lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS list_items (
    list_id     INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
    item_id     TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    title       TEXT,
    thumb       TEXT,
    added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (list_id, item_id)
  );
`);

// ── IPTV channel cache ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS iptv_channels (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    group_name TEXT,
    logo       TEXT,
    url        TEXT,
    epg_id     TEXT,
    source     TEXT NOT NULL DEFAULT 'xtream'
  );

  CREATE INDEX IF NOT EXISTS idx_iptv_ch_group ON iptv_channels(group_name);

  CREATE TABLE IF NOT EXISTS iptv_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS vod_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vod_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'movie',
    year TEXT,
    rating TEXT,
    genre TEXT,
    category_id TEXT,
    thumb TEXT,
    url TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS series_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS series_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'show',
    year TEXT,
    rating TEXT,
    genre TEXT,
    category_id TEXT,
    thumb TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── EPG ──────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS epg_programmes (
    channel_id  TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    start       INTEGER NOT NULL,
    stop        INTEGER NOT NULL,
    description TEXT,
    PRIMARY KEY (channel_id, start)
  );

  CREATE INDEX IF NOT EXISTS idx_epg_ch_time ON epg_programmes(channel_id, stop);
  CREATE INDEX IF NOT EXISTS idx_epg_time    ON epg_programmes(start, stop);

  CREATE TABLE IF NOT EXISTS epg_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── RSS item store ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS rss_items (
    id          TEXT    PRIMARY KEY,
    feed_name   TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    link        TEXT,
    category    TEXT,
    categories  TEXT,
    snippet     TEXT,
    torrent_url TEXT,
    pub_date    INTEGER,
    fetched_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_rss_feed ON rss_items(feed_name, pub_date DESC);
  CREATE INDEX IF NOT EXISTS idx_rss_date ON rss_items(pub_date DESC);
  CREATE INDEX IF NOT EXISTS idx_rss_cat  ON rss_items(category);
`);

// ── Subtitle translation cache ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS subtitle_cache (
    key        TEXT    PRIMARY KEY,
    vtt        TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Add sent_at column if it doesn't exist yet (migration)
try { db.exec('ALTER TABLE rss_items ADD COLUMN sent_at INTEGER'); } catch {}
// Add metadata columns for UNIT3D tracker feeds (size, seeders, resolution, etc.)
try { db.exec('ALTER TABLE rss_items ADD COLUMN meta TEXT'); } catch {}
// Add role column to users (admin / user)
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch {}
// Make the first user an admin automatically
try {
  const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
} catch {}

// ── Error Logs ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS error_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    level      TEXT    NOT NULL DEFAULT 'error' CHECK(level IN ('error','warn','info')),
    source     TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    stack      TEXT,
    context    TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_logs_time   ON error_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_level  ON error_logs(level, created_at DESC);
`);

// ── Seedbox manual TMDB matches (user overrides for auto-match) ─────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS seedbox_matches (
    item_id    INTEGER PRIMARY KEY,
    tmdb_id    INTEGER NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('movie','tv')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// ── TMDB metadata cache ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tmdb_cache (
    key         TEXT    PRIMARY KEY,
    tmdb_id     INTEGER,
    type        TEXT    NOT NULL CHECK(type IN ('movie','tv')),
    title       TEXT,
    year        INTEGER,
    poster      TEXT,
    backdrop    TEXT,
    rating      REAL,
    genres      TEXT,
    overview    TEXT,
    fetched_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_tmdb_fetched ON tmdb_cache(fetched_at);
`);

// ── Users ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

export default db;
