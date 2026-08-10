import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { config } from './config/index.js';
import { logger } from './config/logger.js';
import translationRoutes from './routes/translationRoutes.js';

const app = express();

// Middleware
app.use(cors({
  origin: process.env.VERCEL ? undefined : (process.env['CORS_ORIGIN'] ?? 'http://localhost:5173'),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Serve output files statically for download (path traversal protected in controller)
app.use('/outputs', express.static(path.resolve(config.storage.outputsDir)));

// API routes
app.use('/api', translationRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`[Server] Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
if (!process.env.VERCEL) {
  const port = config.server.port;
  app.listen(port, () => {
    logger.info(`[Server] Translation backend running on http://localhost:${port}`);
    logger.info(`[Server] Health check: http://localhost:${port}/health`);
  });
}

export default app;
