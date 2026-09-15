import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SESSION_TTL_HOURS } from './config.js';
import { stmt, nowIso } from './db.js';
import { closeSessionStreams, closeUserStreams } from './notify.js';

export const SESSION_COOKIE = 'tally_sid';
const BCRYPT_COST = 10;
// Compared against when the username is unknown so failures take similar time.
const DUMMY_HASH = bcrypt.hashSync('tally-dummy-password', BCRYPT_COST);

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(String(password), hash || DUMMY_HASH);
  } catch {
    return false;
  }
}

export function dummyCompare(password) {
  return verifyPassword(password, DUMMY_HASH).then(() => false);
}

// ---- sessions ----

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  stmt('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, created.toISOString(), expires.toISOString());
  return { token, expires };
}

/** Deletes a session and ends the live event streams it opened. */
export function deleteSession(token) {
  if (!token) return;
  stmt('DELETE FROM sessions WHERE token = ?').run(token);
  closeSessionStreams(token);
}

/** Deletes every session of a user (except exceptToken) and ends their live event streams. */
export function deleteUserSessions(userId, exceptToken = null) {
  stmt('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken ?? '');
  closeUserStreams(userId, { exceptToken });
}

export function purgeExpiredSessions() {
  return stmt('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: Boolean(req.secure) };
}

export function setSessionCookie(req, res, { token, expires }) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), expires });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

/** Attaches req.user and req.sessionToken when a valid session cookie is present. */
export function loadSession(req, res, next) {
  req.user = null;
  req.sessionToken = null;
  const token = readCookie(req, SESSION_COOKIE);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const row = stmt(`
      SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.active, u.created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(token);
    if (row) {
      if (row.expires_at <= nowIso() || !row.active) {
        deleteSession(token);
      } else {
        const { expires_at, ...user } = row;
        req.user = { ...user };
        req.sessionToken = token;
      }
    }
  }
  next();
}

// ---- guards ----

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to this" });
    }
    next();
  };
}

/** Every non-GET API request must carry X-Requested-With: fetch. */
export function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Missing or invalid X-Requested-With header' });
  }
  next();
}

// ---- password attempt rate limit (in memory): sign-in and "current password" checks ----

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const attempts = new Map(); // key -> [{ at, pending }]

// "::ffff:127.0.0.1" and "127.0.0.1" are the same client.
const clientIp = (ip) => String(ip ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
const attemptKey = (scope, subject, ip) => `${scope}|${String(subject).toLowerCase()}|${clientIp(ip)}`;

function liveAttempts(key, now = Date.now()) {
  const list = (attempts.get(key) || []).filter((a) => a.pending || now - a.at < ATTEMPT_WINDOW_MS);
  if (list.length) attempts.set(key, list);
  else attempts.delete(key);
  return list;
}

/**
 * Reserves a password attempt *before* the asynchronous bcrypt check, so concurrent requests count against
 * the limit: failures in the last 15 minutes plus attempts still being checked may not exceed 10 per
 * scope + subject + IP. Returns { retryAfter } (seconds, > 0) when limited; otherwise { attempt }, which the
 * caller settles with attempt.succeed() (right password: only this reservation is dropped, earlier failures
 * still count) or attempt.fail(). Settling twice is a no-op, so callers can fail() in a finally block.
 */
export function beginPasswordAttempt(scope, subject, ip) {
  const key = attemptKey(scope, subject, ip);
  const now = Date.now();
  const list = liveAttempts(key, now);
  if (list.length >= MAX_FAILED_ATTEMPTS) {
    const oldest = Math.min(now, ...list.filter((a) => !a.pending).map((a) => a.at));
    return { retryAfter: Math.max(1, Math.ceil((oldest + ATTEMPT_WINDOW_MS - now) / 1000)), attempt: null };
  }
  const entry = { at: now, pending: true };
  list.push(entry);
  attempts.set(key, list);
  let settled = false;
  return {
    retryAfter: 0,
    attempt: {
      fail() {
        if (settled) return;
        settled = true;
        entry.pending = false;
        entry.at = Date.now();
      },
      succeed() {
        if (settled) return;
        settled = true;
        const current = attempts.get(key) || [];
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (!current.length) attempts.delete(key);
      },
    },
  };
}

setInterval(() => {
  for (const key of attempts.keys()) liveAttempts(key);
}, ATTEMPT_WINDOW_MS).unref();
