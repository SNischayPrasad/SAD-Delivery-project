import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import * as config from './config.js';
import { openDb, closeDb, stmt, nowIso } from './db.js';
import {
  loadSession, csrfGuard, hashPassword, purgeExpiredSessions,
} from './auth.js';
import { closeAllStreams } from './notify.js';
import { uploadErrorResponse, removeFile } from './uploads.js';
import configRouter from './routes/config.js';
import authRouter from './routes/auth.js';
import adminInvoicesRouter from './routes/admin-invoices.js';
import adminUsersRouter from './routes/admin-users.js';
import staffRouter from './routes/staff.js';
import notificationsRouter from './routes/notifications.js';
import filesRouter from './routes/files.js';

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
}

function errorHandler(err, req, res, next) {
  // Discard temp uploads left behind by a failed request (moved files are already gone).
  if (req.file?.path) removeFile(req.file.path);
  if (Array.isArray(req.files)) for (const f of req.files) removeFile(f.path);

  if (res.headersSent) return next(err);

  const upload = uploadErrorResponse(err);
  if (upload) return res.status(upload.status).json({ error: upload.error });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });

  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    // Client errors without a safe message (e.g. Express's URIError for a malformed %-escape in a route
    // param) are still client errors, not server failures.
    const fallback = status === 400 ? 'That request was not valid' : 'The request could not be processed';
    return res.status(status).json({ error: err.expose ? err.message : fallback });
  }
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  res.status(500).json({ error: 'Something went wrong' });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', csrfGuard);
  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', loadSession);

  app.use('/api/config', configRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin/invoices', adminInvoicesRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', filesRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(config.PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore' }));
  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  app.use(errorHandler);
  return app;
}

async function seedAdmin() {
  if (stmt("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return;
  if (stmt('SELECT 1 FROM users WHERE username = ?').get(config.ADMIN_USERNAME)) {
    console.error(`No admin exists, but username "${config.ADMIN_USERNAME}" is taken by a staff account. Set ADMIN_USERNAME to create an admin.`);
    return;
  }
  const hash = await hashPassword(config.ADMIN_PASSWORD);
  stmt("INSERT INTO users (username, display_name, password_hash, role, active, created_at) VALUES (?, 'Admin', ?, 'admin', 1, ?)")
    .run(config.ADMIN_USERNAME, hash, nowIso());
  console.log(`Created first admin account "${config.ADMIN_USERNAME}".`);
  if (config.ADMIN_PASSWORD_IS_DEFAULT) {
    console.warn([
      '',
      '************************************************************',
      '*  WARNING: the admin account uses the DEFAULT password    *',
      `*  "admin123". Sign in and change it now, or set           *`,
      '*  ADMIN_PASSWORD before the first run.                    *',
      '************************************************************',
      '',
    ].join('\n'));
  }
}

function clearTempUploads() {
  try {
    for (const name of fs.readdirSync(config.TMP_UPLOAD_DIR)) {
      fs.rmSync(path.join(config.TMP_UPLOAD_DIR, name), { force: true });
    }
  } catch { /* directory may not exist yet */ }
}

let running = null;

/** Boots the app. Only one server per process (the DB connection is a module singleton). */
export async function startServer({ port, dataDir } = {}) {
  if (running) throw new Error('A Tally server is already running in this process');
  const overrides = {};
  if (port !== undefined) overrides.port = port;
  if (dataDir) overrides.dataDir = dataDir;
  config.loadConfig(overrides);

  for (const dir of [config.DATA_DIR, config.INVOICE_DIR, config.PHOTO_DIR, config.TMP_UPLOAD_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  clearTempUploads();
  openDb();
  purgeExpiredSessions();
  await seedAdmin();

  const app = createApp();
  const server = http.createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.PORT, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    closeDb();
    throw err;
  }

  const url = `http://localhost:${server.address().port}`;
  let closing = null;
  const handle = {
    server,
    url,
    close() {
      closing ??= (async () => {
        closeAllStreams();
        const done = new Promise((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        await done;
        closeDb();
        running = null;
      })();
      return closing;
    },
  };
  running = handle;
  return handle;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = pathToFileURL(path.resolve(process.argv[1])).href;
  return process.platform === 'win32'
    ? entry.toLowerCase() === import.meta.url.toLowerCase()
    : entry === import.meta.url;
}

if (isMainModule()) {
  try {
    const { url, close } = await startServer();
    console.log(`Tally is running at ${url}`);
    const shutdown = () => close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use. Set PORT to another port.` : err);
    process.exit(1);
  }
}
