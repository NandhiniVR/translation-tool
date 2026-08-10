import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import {
  getLanguages,
  getDomains,
  translateFile,
  downloadFile,
  runBenchmark,
} from '../controllers/translationController.js';

const router = Router();

// Configure multer for file uploads
// Only accept .mqxliff, .xliff, .docx, and .xml files
const storage = multer.memoryStorage();

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  const allowedExtensions = ['.mqxliff', '.xliff', '.xml', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${ext}. Only .mqxliff, .xliff, .xml, and .docx files are accepted.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1,
  },
});

// API routes
router.get('/languages', getLanguages);
router.get('/domains', getDomains);
router.post('/translate', upload.single('file'), translateFile);
router.post('/benchmark', upload.single('file'), runBenchmark);
router.get('/download/:jobId', downloadFile);

export default router;
