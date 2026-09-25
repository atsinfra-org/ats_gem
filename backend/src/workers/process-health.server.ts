import { createServer, type Server } from 'node:http';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config.service';

export interface ProcessReadiness {
  ready: boolean;
  checks: Record<string, unknown>;
}

/**
 * Minimal HTTP health endpoint for non-API processes (worker, scheduler), used by Docker/ECS
 * health checks: GET /health/live (process up) and GET /health/ready (dependencies + loops).
 */
export function startProcessHealthServer(
  port: number,
  readiness: () => Promise<ProcessReadiness>,
): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { status: 'method_not_allowed' });
    if (req.url === '/health/live') return send(200, { status: 'ok' });
    if (req.url === '/health/ready') {
      readiness()
        .then((r) => send(r.ready ? 200 : 503, { status: r.ready ? 'ok' : 'unavailable', checks: r.checks }))
        .catch((err: unknown) => send(503, { status: 'unavailable', error: err instanceof Error ? err.message : 'error' }));
      return;
    }
    send(404, { status: 'not_found' });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

export const PROCESS_HEALTH = Symbol('PROCESS_HEALTH');

export interface ProcessHealthOptions {
  /** Used when HEALTH_PORT is not set. */
  defaultPort: number;
  readiness: () => Promise<ProcessReadiness>;
}

/** Owns the health server's lifecycle inside a Nest application context. */
@Injectable()
export class ProcessHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private server?: Server;

  constructor(
    @Inject(PROCESS_HEALTH) private readonly options: ProcessHealthOptions,
    private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProcessHealthServer.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    const port = this.config.get('HEALTH_PORT') ?? this.options.defaultPort;
    this.server = await startProcessHealthServer(port, this.options.readiness);
    this.logger.info({ port: this.port() }, `Health endpoints on http://localhost:${this.port()}/health/{live,ready}`);
  }

  /** The bound port (differs from the configured one when HEALTH_PORT=0 picks a free port). */
  port(): number | undefined {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
