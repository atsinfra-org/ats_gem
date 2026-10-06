import type { RedisOptions } from 'bullmq';

function parse(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
    // ElastiCache in-transit encryption uses rediss:// URLs.
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

/**
 * Producers fail fast when Redis is unreachable instead of buffering commands, so callers (the
 * outbox relay, HTTP handlers) see the error and back off rather than hang.
 */
export function producerConnection(url: string): RedisOptions {
  return { ...parse(url), enableOfflineQueue: false, maxRetriesPerRequest: 1 };
}

/** Workers block on Redis and must survive reconnects, so they queue commands while reconnecting. */
export function workerConnection(url: string): RedisOptions {
  return { ...parse(url), enableOfflineQueue: true, maxRetriesPerRequest: null };
}
