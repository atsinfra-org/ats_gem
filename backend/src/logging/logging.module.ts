import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../config/app-config.service';

type RequestWithId = IncomingMessage & { id?: string };

/** Paths whose values must never reach log storage. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
  '*.credentials',
  '*.username',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          base: { service: config.get('APP_NAME'), process: process.env.PROCESS_ROLE ?? 'api' },
          timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
          messageKey: 'message',
          redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
          // requestIdMiddleware assigns the ID first; this fallback covers non-HTTP-pipeline use.
          genReqId: (req: RequestWithId) => req.id ?? randomUUID(),
          customProps: (req: RequestWithId) => ({ requestId: req.id }),
          customAttributeKeys: { responseTime: 'durationMs' },
          customLogLevel: (req, res, err) => {
            // Failing health probes are expected during incidents; keep them out of error alerts.
            if (req.url === '/health/ready' || req.url === '/health/queues') return res.statusCode >= 500 ? 'warn' : 'debug';
            return err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          },
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, route: req.url }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url === '/health/live' },
          transport:
            (config.get('LOG_FORMAT') ?? (config.isProduction || config.isTest ? 'json' : 'pretty')) === 'pretty'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' } }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
