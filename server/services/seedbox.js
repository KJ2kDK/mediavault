/**
 * Seedbox SSH Connection Manager
 *
 * Provides a persistent SSH connection pool to the seedbox for:
 * - Running commands (ffprobe, ffmpeg, ls, find)
 * - Reading files (subtitles, nfo)
 * - Streaming media via FFmpeg pipe
 *
 * Uses ssh2 npm package with key-based authentication.
 */

import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Configuration (from .env) ───────────────────────────────────────────────
const config = {
  host: process.env.SEEDBOX_HOST || 'hati.whatbox.ca',
  port: Number(process.env.SEEDBOX_PORT) || 22,
  username: process.env.SEEDBOX_USER || 'spliffstar',
  mediaPath: process.env.SEEDBOX_MEDIA_PATH || '/home/spliffstar/Downloads',
  // Key path — try env var first, fall back to default location
  keyPath: process.env.SEEDBOX_KEY_PATH || join(homedir(), '.ssh', 'id_ed25519'),
};

let privateKey;
try {
  privateKey = readFileSync(config.keyPath);
  console.log(`[seedbox] SSH key loaded from ${config.keyPath}`);
} catch (e) {
  console.warn(`[seedbox] SSH key not found at ${config.keyPath} — seedbox features disabled`);
}

// ── Connection Pool ─────────────────────────────────────────────────────────
// We maintain a small pool of SSH connections to avoid reconnecting per request.
const POOL_SIZE = 3;
const pool = [];
let poolReady = false;
let sharedSftp = null;  // Reusable SFTP session (avoids opening 20+ per scan)

function createConnection() {
  return new Promise((resolve, reject) => {
    if (!privateKey) return reject(new Error('No SSH key configured'));

    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timeout'));
    }, 10000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn._available = true;
      resolve(conn);
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    conn.on('close', () => {
      // Remove from pool on close
      const idx = pool.indexOf(conn);
      if (idx >= 0) pool.splice(idx, 1);
    });

    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 10000,
    });
  });
}

async function getConnection() {
  // Try to find an available connection in the pool
  for (const conn of pool) {
    if (conn._available) {
      return conn;
    }
  }

  // Create a new one if pool isn't full
  if (pool.length < POOL_SIZE) {
    const conn = await createConnection();
    pool.push(conn);
    return conn;
  }

  // All connections busy — wait briefly and retry
  await new Promise((r) => setTimeout(r, 100));
  return getConnection();
}

/**
 * Initialize the connection pool. Call once on server start.
 */
export async function initPool() {
  if (!privateKey) {
    console.warn('[seedbox] Skipping pool init — no SSH key');
    return false;
  }

  try {
    const conn = await createConnection();
    pool.push(conn);
    poolReady = true;
    console.log(`[seedbox] Connected to ${config.host} as ${config.username}`);
    return true;
  } catch (e) {
    console.error(`[seedbox] Connection failed: ${e.message}`);
    return false;
  }
}

/**
 * Check if seedbox connection is available.
 */
export function isConnected() {
  return poolReady && pool.length > 0;
}

// ── Command Execution ───────────────────────────────────────────────────────

/**
 * Execute a shell command on the seedbox and return stdout.
 * @param {string} cmd - Shell command to run
 * @param {object} opts - Options: { timeout: ms, maxBuffer: bytes }
 * @returns {Promise<string>} stdout
 */
export async function exec(cmd, opts = {}) {
  const { timeout = 30000, maxBuffer = 10 * 1024 * 1024 } = opts;
  const conn = await getConnection();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeout}ms: ${cmd.slice(0, 80)}`));
    }, timeout);

    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }

      let stdout = '';
      let stderr = '';

      stream.on('data', (d) => {
        stdout += d.toString();
        if (stdout.length > maxBuffer) {
          stream.close();
          clearTimeout(timer);
          reject(new Error('Command output exceeded maxBuffer'));
        }
      });

      stream.stderr.on('data', (d) => { stderr += d.toString(); });

      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || stdout.length > 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });
    });
  });
}

/**
 * Execute a command and return a readable stream (for piping FFmpeg output).
 * The caller is responsible for handling the stream lifecycle.
 * @param {string} cmd - Shell command to run
 * @returns {Promise<{stream: ReadableStream, conn: Client}>}
 */
export async function execStream(cmd) {
  const conn = await getConnection();

  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      resolve({ stream, conn });
    });
  });
}

/**
 * Get or create a shared SFTP session (reuses one session for all SFTP ops).
 * This avoids exhausting the SSH server's max SFTP channel limit during scans.
 */
async function getSftp() {
  if (sharedSftp) return sharedSftp;

  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sharedSftp = sftp;
      // If the underlying connection closes, clear the cached sftp
      conn.on('close', () => { if (sharedSftp === sftp) sharedSftp = null; });
      resolve(sftp);
    });
  });
}

/**
 * Read a file from the seedbox.
 * @param {string} filePath - Absolute path on the seedbox
 * @returns {Promise<string>} File contents as UTF-8 string
 */
export async function readFile(filePath, encoding = 'utf-8') {
  const sftp = await getSftp();
  return new Promise((resolve, reject) => {
    sftp.readFile(filePath, encoding, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/**
 * List files/directories at a path on the seedbox.
 * @param {string} dirPath - Absolute directory path
 * @returns {Promise<Array<{name, type, size, mtime}>>}
 */
export async function listDir(dirPath) {
  const sftp = await getSftp();
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) return reject(err);
      resolve(
        list.map((item) => ({
          name: item.filename,
          type: item.attrs.isDirectory() ? 'directory' : 'file',
          size: item.attrs.size,
          mtime: new Date(item.attrs.mtime * 1000),
        }))
      );
    });
  });
}

/**
 * Create a readable stream for a file on the seedbox, with optional byte range.
 * Returns an SFTP read stream that supports the `start`/`end` options.
 * @param {string} filePath - Absolute path
 * @param {object} opts - { start?: number, end?: number }
 * @returns {Promise<ReadStream>}
 */
export async function readStream(filePath, opts = {}) {
  const sftp = await getSftp();
  return sftp.createReadStream(filePath, {
    start: opts.start,
    end: opts.end,
    autoClose: true,
    highWaterMark: 256 * 1024,
  });
}

/**
 * Get file stats (size, mtime) for a single file.
 */
export async function stat(filePath) {
  const sftp = await getSftp();
  return new Promise((resolve, reject) => {
    sftp.stat(filePath, (err, stats) => {
      if (err) return reject(err);
      resolve({
        size: stats.size,
        mtime: new Date(stats.mtime * 1000),
        isDirectory: stats.isDirectory(),
      });
    });
  });
}

// ── Convenience: Media Path ─────────────────────────────────────────────────

/**
 * Get the configured media root path on the seedbox.
 */
export function getMediaPath() {
  return config.mediaPath;
}

/**
 * Get seedbox connection config (for display in settings, no secrets).
 */
export function getConfig() {
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    mediaPath: config.mediaPath,
    connected: isConnected(),
  };
}

/**
 * Gracefully close all connections on shutdown.
 */
export function closeAll() {
  for (const conn of pool) {
    try { conn.end(); } catch {}
  }
  pool.length = 0;
  poolReady = false;
}

export default {
  initPool,
  isConnected,
  exec,
  execStream,
  readFile,
  readStream,
  listDir,
  stat,
  getMediaPath,
  getConfig,
  closeAll,
};
