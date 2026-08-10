import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname replacement (tsx v4 runs in ESM mode)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels above backend/src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${value}`);
  }
  return parsed;
}

export const config = {
  provider: getEnv('AI_PROVIDER', 'gemini').toLowerCase() as 'gemini' | 'groq',
  gemini: {
    apiKey: getEnv('GEMINI_API_KEY', ''),
    model: getEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    maxRetries: getEnvInt('MAX_RETRIES', getEnvInt('GEMINI_MAX_RETRIES', 1)),
  },
  groq: {
    apiKey: getEnv('GROQ_API_KEY', ''),
    model: getEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    maxRetries: getEnvInt('GROQ_MAX_RETRIES', 1),
  },
  server: {
    port: getEnvInt('PORT', 3001),
  },
  translation: {
    concurrency: getEnvInt('TRANSLATION_CONCURRENCY', 3),
    batchSize: getEnvInt('TRANSLATION_BATCH_SIZE', getEnvInt('BATCH_SIZE', 10)),
  },
  storage: {
    uploadsDir: path.resolve(__dirname, '..', '..', '..', getEnv('UPLOADS_DIR', 'uploads')),
    outputsDir: path.resolve(__dirname, '..', '..', '..', getEnv('OUTPUTS_DIR', 'outputs')),
  },
  context: {
    maxChars: getEnvInt('CONTEXT_MAX_CHARS', 500),
  },
} as const;

export type Config = typeof config;
