import Redis from 'ioredis';

/**
 * Whether a Redis server is reachable. Queue suites are skipped without one (a developer machine
 * without Docker); CI sets REQUIRE_REDIS=true so a missing Redis fails the build instead.
 */
export async function redisAvailable(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: 1_000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    if (process.env.REQUIRE_REDIS === 'true') throw new Error(`REQUIRE_REDIS=true but Redis is unreachable at ${url}`);
    return false;
  } finally {
    client.disconnect();
  }
}

/** Deletes every key under a BullMQ prefix (the suite's private key space). */
export async function deletePrefix(prefix: string, url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Promise<void> {
  const client = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await client.del(...keys);
    } while (cursor !== '0');
  } finally {
    client.disconnect();
  }
}

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 10_000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: condition not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
