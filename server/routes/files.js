/**
 * Seedbox File Manager — Admin-only API routes.
 *
 * Browse, rename, create, and delete files/folders on the seedbox over SSH.
 * Every route requires an authenticated admin (RBAC via requireAdmin). All
 * operations are confined to the configured media root so a slip can't touch
 * the rest of the filesystem.
 */

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import seedbox from '../services/seedbox.js';

const router = Router();

// Every file-manager route is admin-only.
router.use(requireAdmin);

// Escape a path for safe interpolation inside a double-quoted shell argument.
function shellEscape(str) {
  return String(str).replace(/(["$`\\])/g, '\\$1');
}

/**
 * Resolve a client-supplied path against the media root and verify it stays
 * inside it. Returns the normalized absolute path, or null if it escapes the
 * root (e.g. via `..`) or is otherwise invalid.
 */
function resolveSafe(inputPath) {
  const root = seedbox.getMediaPath()?.replace(/\/+$/, '');
  if (!root) return null;

  // Empty / undefined → the root itself.
  let raw = (inputPath ?? '').toString().trim();
  if (raw === '' || raw === '/') return root;

  // Absolute input must already live under root; relative input is joined to it.
  let combined = raw.startsWith('/') ? raw : `${root}/${raw}`;

  // Normalize: collapse slashes and resolve . / .. segments manually (POSIX).
  const parts = [];
  for (const seg of combined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  const normalized = '/' + parts.join('/');

  if (normalized !== root && !normalized.startsWith(root + '/')) return null;
  return normalized;
}

// ── GET /api/files/list?path=... — list a directory ─────────────────────────
router.get('/list', async (req, res) => {
  const root = seedbox.getMediaPath()?.replace(/\/+$/, '');
  const dir = resolveSafe(req.query.path);
  if (!dir) return res.status(400).json({ error: 'Invalid path' });

  try {
    const entries = await seedbox.listDir(dir);
    const sorted = entries
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        type: e.type,
        size: e.size,
        mtime: e.mtime,
        path: `${dir}/${e.name}`,
      }));

    res.json({
      path: dir,
      root,
      atRoot: dir === root,
      parent: dir === root ? null : dir.slice(0, dir.lastIndexOf('/')) || root,
      entries: sorted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/files/delete — { path } delete a file or folder ───────────────
router.post('/delete', async (req, res) => {
  const root = seedbox.getMediaPath()?.replace(/\/+$/, '');
  const target = resolveSafe(req.body?.path);
  if (!target) return res.status(400).json({ error: 'Invalid path' });
  if (target === root) return res.status(400).json({ error: 'Refused: cannot delete the media root' });

  try {
    await seedbox.exec(`rm -rf -- "${shellEscape(target)}"`, { timeout: 60000 });
    console.log(`[files] Deleted: ${target}`);
    res.json({ ok: true, deleted: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/files/rename — { path, newName } rename within same folder ────
router.post('/rename', async (req, res) => {
  const src = resolveSafe(req.body?.path);
  const newName = (req.body?.newName ?? '').toString().trim();
  if (!src) return res.status(400).json({ error: 'Invalid path' });
  if (!newName || newName.includes('/') || newName === '.' || newName === '..') {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const root = seedbox.getMediaPath()?.replace(/\/+$/, '');
  if (src === root) return res.status(400).json({ error: 'Refused: cannot rename the media root' });

  const dest = `${src.slice(0, src.lastIndexOf('/'))}/${newName}`;
  try {
    await seedbox.exec(`mv -n -- "${shellEscape(src)}" "${shellEscape(dest)}"`, { timeout: 30000 });
    console.log(`[files] Renamed: ${src} → ${dest}`);
    res.json({ ok: true, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/files/mkdir — { path, name } create a folder ──────────────────
router.post('/mkdir', async (req, res) => {
  const dir = resolveSafe(req.body?.path);
  const name = (req.body?.name ?? '').toString().trim();
  if (!dir) return res.status(400).json({ error: 'Invalid path' });
  if (!name || name.includes('/') || name === '.' || name === '..') {
    return res.status(400).json({ error: 'Invalid name' });
  }

  const target = `${dir}/${name}`;
  try {
    await seedbox.exec(`mkdir -p -- "${shellEscape(target)}"`, { timeout: 15000 });
    res.json({ ok: true, path: target });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
