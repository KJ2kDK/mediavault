import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'mediavault-dev-secret-change-in-production';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  // Accept token from Authorization header OR ?token= query param
  // (HLS.js and <img> tags can't set custom headers, so they use the query param)
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ')
    ? header.slice(7)
    : req.query.token || null;

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
