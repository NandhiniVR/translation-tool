import * as winston from 'winston';

/**
 * Application logger.
 *
 * Logs are structured JSON in production and human-readable in development.
 * Do NOT log full segment text or API keys.
 */
export const logger = winston.createLogger({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
  format: process.env['NODE_ENV'] === 'production'
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} ${level}: ${message}${metaStr}`;
        })
      ),
  transports: [
    new winston.transports.Console(),
  ],
});
