import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { resolveAllowedViews } from '../config/views.js';

const router = Router();

// POST /api/auth/register — only works when no users exist (first-time setup)
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    if (count > 0) return res.status(403).json({ error: 'Registration disabled — user already exists' });

    const hash = await bcrypt.hash(password, 10);
    // First user is always admin
    const result = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')").run(username, hash);

    const token = signToken({ id: result.lastInsertRowid, username, role: 'admin' });
    res.json({ token, username, role: 'admin' });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: user.id, username: user.username, role: user.role || 'user' });
    res.json({ token, username: user.username, role: user.role || 'user' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — check if token is valid
router.get('/me', requireAuth, (req, res) => {
  // Re-fetch from DB in case role/permissions changed since the token was issued
  const user = db.prepare('SELECT username, role, allowed_views, seedbox_readonly FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const role = user.role || 'user';
  res.json({
    username: user.username,
    role,
    allowedViews: resolveAllowedViews(role, user.allowed_views),
    // Admins always have full seedbox access; flag only restricts non-admins.
    seedboxReadonly: role === 'admin' ? false : !!user.seedbox_readonly,
  });
});

// GET /api/auth/status — check if any users exist (public)
router.get('/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  res.json({ hasUsers: count > 0 });
});

export default router;
