import { Router } from 'express';
import { stmt, nowIso, parseId } from '../db.js';
import { requireRole, hashPassword, deleteUserSessions } from '../auth.js';
import { closeUserStreams } from '../notify.js';
import { userJson, bodyOf } from '../serializers.js';

const router = Router();
router.use(requireRole('admin'));

const ROLES = ['admin', 'staff'];
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const USER_COLUMNS = 'id, username, display_name, role, active, created_at';

const bad = (res, message) => res.status(400).json({ error: message });

function validDisplayName(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= 80;
}

router.get('/', (req, res) => {
  const rows = stmt(`SELECT ${USER_COLUMNS} FROM users ORDER BY active DESC, display_name COLLATE NOCASE, id`).all();
  res.json({ users: rows.map(userJson) });
});

router.post('/', async (req, res) => {
  const b = bodyOf(req);
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const role = b.role ?? 'staff';
  if (!USERNAME_RE.test(username)) {
    return bad(res, 'Username must be 3–40 characters: letters, numbers, dots, dashes or underscores');
  }
  if (!validDisplayName(b.display_name)) return bad(res, 'Display name is required (80 characters max)');
  if (typeof b.password !== 'string' || b.password.length < 8) {
    return bad(res, 'Password must be at least 8 characters');
  }
  if (b.password.length > 200) return bad(res, 'Password must be 200 characters or fewer');
  if (!ROLES.includes(role)) return bad(res, 'Role must be admin or staff');

  if (stmt('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: `Username ${username} is already taken` });
  }
  const hash = await hashPassword(b.password);
  let id;
  try {
    id = Number(stmt(
      'INSERT INTO users (username, display_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(username, b.display_name.trim(), hash, role, nowIso()).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: `Username ${username} is already taken` });
    throw err;
  }
  const row = stmt(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
  res.status(201).json({ user: userJson(row) });
});

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const user = id && stmt(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const b = bodyOf(req);
  const updates = {};
  if (b.display_name !== undefined) {
    if (!validDisplayName(b.display_name)) return bad(res, 'Display name is required (80 characters max)');
    updates.display_name = b.display_name.trim();
  }
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < 8) {
      return bad(res, 'Password must be at least 8 characters');
    }
    if (b.password.length > 200) return bad(res, 'Password must be 200 characters or fewer');
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return bad(res, 'active must be true or false');
    updates.active = b.active ? 1 : 0;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return bad(res, 'Role must be admin or staff');
    updates.role = b.role;
  }

  const isSelf = user.id === req.user.id;
  if (isSelf && b.password !== undefined) {
    // Your own password changes through POST /api/auth/password, which checks the current password.
    return res.status(422).json({ error: 'Use Change password to change your own password' });
  }
  if (isSelf && updates.active === 0) {
    return res.status(422).json({ error: "You can't deactivate your own account" });
  }
  if (isSelf && updates.role && updates.role !== 'admin') {
    return res.status(422).json({ error: "You can't remove your own admin role" });
  }

  if (b.password !== undefined) updates.password_hash = await hashPassword(b.password);

  const columns = Object.keys(updates);
  if (columns.length) {
    const sets = columns.map((c) => `${c} = ?`).join(', ');
    stmt(`UPDATE users SET ${sets} WHERE id = ?`).run(...columns.map((c) => updates[c]), user.id);
  }

  const deactivated = updates.active === 0 && user.active;
  const roleChanged = updates.role && updates.role !== user.role;
  const passwordReset = b.password !== undefined; // never self (rejected above)
  // deleteUserSessions also ends the user's live event streams.
  if (deactivated || passwordReset) deleteUserSessions(user.id);
  // Open SSE streams cache the role; drop them so clients reconnect with fresh access.
  else if (roleChanged) closeUserStreams(user.id);

  const row = stmt(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(user.id);
  res.json({ user: userJson(row) });
});

export default router;
