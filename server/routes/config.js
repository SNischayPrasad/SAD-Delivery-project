import { Router } from 'express';
import { MAX_INVOICE_MB, MAX_PHOTO_MB, MAX_PHOTOS_PER_UPLOAD } from '../config.js';
import { requireAuth } from '../auth.js';

// Client-facing limits, so the apps check uploads against what the server actually enforces.
const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({
    max_invoice_mb: MAX_INVOICE_MB,
    max_photo_mb: MAX_PHOTO_MB,
    max_photos_per_upload: MAX_PHOTOS_PER_UPLOAD,
  });
});

export default router;
