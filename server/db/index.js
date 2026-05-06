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

// Idempotent migration: add bookmarks.source to distinguish 'iptv' vs 'seedbox'.
// Existing rows default to 'iptv' (backward compatible).
{
  const cols = db.prepare("PRAGMA table_info(bookmarks)").all();
  if (!cols.some((c) => c.name === 'source')) {
    db.exec("ALTER TABLE bookmarks ADD COLUMN source TEXT NOT NULL DEFAULT 'iptv'");
  }
}

// Server-side RSS feed list — replaces per-browser localStorage so feeds
// sync across PC, Shield app, phone, etc.
db.exec(`
  CREATE TABLE IF NOT EXISTS rss_feeds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    cookie      TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    added_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feeds_url ON rss_feeds(url);
`);

// Seed defaults on first boot (idempotent — only inserts if table is empty).
{
  const count = db.prepare('SELECT COUNT(*) AS n FROM rss_feeds').get().n;
  if (count === 0) {
    const seed = db.prepare('INSERT INTO rss_feeds (name, url, enabled, sort_order) VALUES (?, ?, 1, ?)');
    seed.run('TorrentFreak', 'https://torrentfreak.com/feed/', 0);
    seed.run('Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 1);
  }
}

// Permanent feed guarantee — runs every boot, idempotent.
//
// Reads RSS_FEEDS from .env and ensures each entry exists in the DB.
// If a row with the same URL already exists, it's left alone (so the user
// can rename / disable / move it through the UI). If the volume is ever
// wiped or the user deletes a feed by accident, the next container start
// recreates it from .env. Never source-controlled — the URLs contain
// personal API keys / RSS passkeys.
//
// Format (one feed per line, '|' separators):
//   RSS_FEEDS="Name|https://example.com/rss|optional-cookie\nName2|..."
// Or use multiple env vars: RSS_FEED_1, RSS_FEED_2, ...
{
  const collected = [];
  if (process.env.RSS_FEEDS) {
    for (const line of process.env.RSS_FEEDS.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const [name, url, cookie] = t.split('|').map((s) => s?.trim() ?? '');
      if (name && url) collected.push({ name, url, cookie: cookie || null });
    }
  }
  for (let i = 1; ; i++) {
    const v = process.env[`RSS_FEED_${i}`];
    if (!v) break;
    const [name, url, cookie] = v.split('|').map((s) => s?.trim() ?? '');
    if (name && url) collected.push({ name, url, cookie: cookie || null });
  }

  if (collected.length > 0) {
    const byUrl = db.prepare('SELECT id FROM rss_feeds WHERE url = ?');
    const placeholderByName = db.prepare(
      "SELECT id FROM rss_feeds WHERE name = ? AND url LIKE 'placeholder://%'"
    );
    const upgrade = db.prepare(
      'UPDATE rss_feeds SET url = ?, cookie = COALESCE(?, cookie), enabled = 1 WHERE id = ?'
    );
    const insert = db.prepare(
      'INSERT INTO rss_feeds (name, url, cookie, enabled, sort_order) VALUES (?, ?, ?, 1, ?)'
    );
    const maxOrder = () => db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM rss_feeds').get().n;
    let added = 0, upgraded = 0;
    for (const f of collected) {
      if (byUrl.get(f.url)) continue;
      // If a placeholder row exists for this feed name (from orphan
      // recovery), upgrade it in place so cached articles keep their
      // mapping instead of creating a duplicate row.
      const placeholder = placeholderByName.get(f.name);
      if (placeholder) {
        upgrade.run(f.url, f.cookie, placeholder.id);
        upgraded++;
      } else {
        insert.run(f.name, f.url, f.cookie, maxOrder() + 1);
        added++;
      }
    }
    if (added + upgraded > 0) {
      console.log(`[db] RSS .env seeder: ${added} added, ${upgraded} upgraded from placeholder`);
    }
  }
}

// Recover orphan feeds: any feed_name that has cached rss_items but no
// matching row in rss_feeds (typically because the user previously had
// the feed in localStorage and we lost it during the volume-bug era).
// Insert a disabled placeholder so the filter chip + cached articles are
// visible again. The user can edit the row to add the real URL whenever
// they want fresh fetches.
{
  const orphans = db.prepare(`
    SELECT DISTINCT feed_name FROM rss_items
    WHERE feed_name IS NOT NULL
      AND feed_name NOT IN (SELECT name FROM rss_feeds)
  `).all();

  if (orphans.length > 0) {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM rss_feeds').get().n;
    const insert = db.prepare(
      'INSERT INTO rss_feeds (name, url, cookie, enabled, sort_order) VALUES (?, ?, NULL, 0, ?)'
    );
    let order = maxOrder + 1;
    for (const { feed_name } of orphans) {
      // Use a unique placeholder URL so the UNIQUE(url) index is happy.
      // Refresh logic already skips disabled feeds, so this never fires
      // a fetch — the user must edit the URL to enable real polling.
      const placeholder = `placeholder://${encodeURIComponent(feed_name)}`;
      insert.run(feed_name, placeholder, order++);
    }
    console.log(`[db] Recovered ${orphans.length} orphan RSS feed(s) from cached items`);
  }
}

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
// (users table + role migration moved to end of file, near users CREATE TABLE)

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
  CREATE INDEX IF NOT EXISTS idx_tmdb_id_type ON tmdb_cache(tmdb_id, type);
`);

// ── Users ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migration: add role column for DBs created before it existed
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch {}

// First user is always admin (runs every startup, idempotent)
try {
  const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
} catch {}

export default db;
