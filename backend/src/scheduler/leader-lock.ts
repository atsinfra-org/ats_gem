import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const ACQUIRE_OR_RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
elseif redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return 1
end
return 0`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * Single-leader election over one Redis key with a TTL. The holder renews on every cycle; if it
 * dies, the key expires and another replica takes over. Not a correctness lock — schedule
 * reconciliation is idempotent — it only avoids redundant work across replicas.
 */
export class LeaderLock {
  readonly token = randomUUID();

  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly ttlMs: number,
  ) {}

  async acquireOrRenew(): Promise<boolean> {
    const result = await this.redis.eval(ACQUIRE_OR_RENEW, 1, this.key, this.token, String(this.ttlMs));
    return result === 1;
  }

  async release(): Promise<void> {
    await this.redis.eval(RELEASE, 1, this.key, this.token);
  }
}
