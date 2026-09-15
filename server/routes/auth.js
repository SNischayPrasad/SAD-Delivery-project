import { Router } from 'express';
import { stmt } from '../db.js';
import {
  requireAuth, verifyPassword, dummyCompare, hashPassword, createSession, deleteSession,
  deleteUserSessions, setSessionCookie, clearSessionCookie, beginPasswordAttempt,
} from '../auth.js';
import { userJson, bodyOf } from '../serializers.js';

const router = Router();
const ROLES = ['admin', 'staff'];

function tooManyAttempts(res, retryAfter, message) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message });
}

router.post('/login', async (req, res) => {
  const { username, password, role } = bodyOf(req);
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Enter your username and password' });
  }
  if (role != null && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or staff' });
  }
  const name = username.trim().slice(0, 100);

  // Reserve the attempt before the async password check so concurrent guesses count too.
  const { retryAfter, attempt } = beginPasswordAttempt('login', name, req.ip);
  if (retryAfter) return tooManyAttempts(res, retryAfter, 'Too many failed sign-in attempts. Try again in 15 minutes.');
  try {
    const user = stmt('SELECT * FROM users WHERE username = ?').get(name);
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyCompare(password);
    if (!user || !ok || !user.active) {
      attempt.fail();
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    attempt.succeed();
    if (role && user.role !== role) {
      return res.status(403).json({
        error: `This account is not a ${role} account. Use the ${user.role} sign-in.`,
      });
    }

    if (req.sessionToken) deleteSession(req.sessionToken);
    const session = createSession(user.id);
    setSessionCookie(req, res, session);
    res.json({ user: userJson(user) });
  } finally {
    attempt.fail(); // no-op once settled; counts the attempt if the handler threw
  }
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) deleteSession(req.sessionToken);
  clearSessionCookie(req, res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: userJson(req.user) });
});

router.post('/password', requireAuth, async (req, res) => {
  const { current_password: current, new_password: next } = bodyOf(req);
  if (typeof next !== 'string' || next.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (next.length > 200) {
    return res.status(400).json({ error: 'New password must be 200 characters or fewer' });
  }
  const { retryAfter, attempt } = beginPasswordAttempt('password', req.user.id, req.ip);
  if (retryAfter) return tooManyAttempts(res, retryAfter, 'Too many wrong current passwords. Try again in 15 minutes.');
  try {
    const row = stmt('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (typeof current !== 'string' || !row || !(await verifyPassword(current, row.password_hash))) {
      attempt.fail();
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    attempt.succeed();
    const hash = await hashPassword(next);
    stmt('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    // Sign out other devices (their sessions and live streams); keep this session.
    deleteUserSessions(req.user.id, req.sessionToken);
    res.status(204).end();
  } finally {
    attempt.fail();
  }
});

export default router;
