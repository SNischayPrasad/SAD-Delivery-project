import { stmt, nowIso, afterCommit } from './db.js';
import { notificationJson } from './serializers.js';

const HEARTBEAT_MS = 25_000;
const clients = new Set(); // { res, userId, role, token, timer }

function dropClient(client) {
  if (!clients.delete(client)) return;
  clearInterval(client.timer);
}

function endClient(client) {
  dropClient(client);
  try { client.res.end(); } catch { /* ignore */ }
}

// A stream is only as good as the session that opened it: signed out, expired, deactivated or a changed
// role all end it. Checked before every event and on every heartbeat.
function sessionValid(client) {
  try {
    const row = stmt(`
      SELECT s.expires_at, u.active, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(client.token);
    return Boolean(row && row.expires_at > nowIso() && row.active && row.role === client.role);
  } catch {
    return false; // database closed (server shutting down)
  }
}

function send(client, event, data) {
  if (!sessionValid(client)) {
    endClient(client);
    return;
  }
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    dropClient(client);
  }
}

export function unreadCount(userId) {
  return stmt('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

/** Handles GET /api/notifications/stream. */
export function openStream(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  req.socket.setKeepAlive?.(true);
  req.socket.setTimeout?.(0);

  const client = { res, userId: req.user.id, role: req.user.role, token: req.sessionToken, timer: null };
  client.timer = setInterval(() => {
    if (!sessionValid(client)) {
      endClient(client);
      return;
    }
    try { res.write(': ping\n\n'); } catch { dropClient(client); }
  }, HEARTBEAT_MS);
  client.timer.unref();
  clients.add(client);

  send(client, 'hello', { unread: unreadCount(req.user.id) });

  // res 'close' fires when the client disconnects (req 'close' can fire early for GETs).
  const cleanup = () => dropClient(client);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

/** Inserts a notification; pushes it over SSE once the surrounding transaction commits. */
export function notifyUser(userId, type, invoiceId, message) {
  const createdAt = nowIso();
  const { lastInsertRowid } = stmt(
    'INSERT INTO notifications (user_id, type, invoice_id, message, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, type, invoiceId ?? null, message, createdAt);
  const json = notificationJson({
    id: Number(lastInsertRowid), type, message, invoice_id: invoiceId ?? null, read_at: null, created_at: createdAt,
  });
  afterCommit(() => {
    for (const client of [...clients]) if (client.userId === userId) send(client, 'notification', json);
  });
  return json;
}

export function notifyActiveAdmins(type, invoiceId, message) {
  const admins = stmt("SELECT id FROM users WHERE role = 'admin' AND active = 1").all();
  return admins.map((a) => notifyUser(a.id, type, invoiceId, message));
}

/** User ids with at least one event on the invoice (used to target staff broadcasts). */
export function invoiceParticipants(invoiceId) {
  return new Set(
    stmt('SELECT DISTINCT user_id FROM invoice_events WHERE invoice_id = ? AND user_id IS NOT NULL')
      .all(invoiceId).map((r) => r.user_id),
  );
}

/**
 * Broadcasts `event: invoice` to all admins and to staff with events on the invoice.
 * Pass participants when the invoice rows are about to disappear (delete).
 */
export function broadcastInvoice(invoiceId, status, participants = null) {
  const users = participants ?? invoiceParticipants(invoiceId);
  afterCommit(() => {
    const data = { id: invoiceId, status };
    for (const client of [...clients]) {
      if (client.role === 'admin' || users.has(client.userId)) send(client, 'invoice', data);
    }
  });
}

/** Ends the streams opened by one session (sign-out, expired session). */
export function closeSessionStreams(token) {
  for (const client of [...clients]) if (client.token === token) endClient(client);
}

/** Ends a user's streams, optionally keeping the ones opened by exceptToken (password change on this device). */
export function closeUserStreams(userId, { exceptToken = null } = {}) {
  for (const client of [...clients]) {
    if (client.userId === userId && (!exceptToken || client.token !== exceptToken)) endClient(client);
  }
}

export function closeAllStreams() {
  for (const client of [...clients]) endClient(client);
}
