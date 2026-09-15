import { Router } from 'express';
import { stmt, nowIso, parseId } from '../db.js';
import { requireAuth } from '../auth.js';
import { openStream, unreadCount } from '../notify.js';
import { notificationJson } from '../serializers.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = stmt('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(req.user.id);
  res.json({ unread: unreadCount(req.user.id), notifications: rows.map(notificationJson) });
});

router.get('/stream', openStream);

router.post('/read-all', (req, res) => {
  stmt('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), req.user.id);
  res.status(204).end();
});

router.post('/:id/read', (req, res) => {
  const id = parseId(req.params.id);
  const row = id && stmt('SELECT id, read_at FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Notification not found' });
  if (!row.read_at) stmt('UPDATE notifications SET read_at = ? WHERE id = ?').run(nowIso(), row.id);
  res.status(204).end();
});

export default router;
