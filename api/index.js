// Vercel executes this JavaScript function after the configured backend build.
// Importing the emitted ESM avoids relying on TypeScript source-resolution at runtime.
import app from '../backend/dist/index.js';

export default app;
