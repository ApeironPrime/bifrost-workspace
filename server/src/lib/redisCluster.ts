import { createAdapter } from "@socket.io/redis-adapter";
import type { ClientRateLimitInfo, Store } from "express-rate-limit";
import { createClient } from "redis";
import type { Server } from "socket.io";

export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  decr?(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<number | boolean>;
  pTTL(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

export function createRedisRateLimitStore(
  client: RedisRateLimitClient,
  prefix: string,
  windowMs: number,
): Store {
  const makeKey = (key: string) => `bifrost:rl:${prefix}:${key}`;

  return {
    localKeys: false,
    prefix,
    async increment(key: string): Promise<ClientRateLimitInfo> {
      const fullKey = makeKey(key);
      const totalHits = await client.incr(fullKey);
      let ttlMs = await client.pTTL(fullKey);
      if (totalHits === 1 || ttlMs < 0) {
        await client.pExpire(fullKey, windowMs);
        ttlMs = windowMs;
      }
      return {
        totalHits,
        resetTime: new Date(Date.now() + Math.max(0, ttlMs)),
      };
    },
    async decrement(key: string): Promise<void> {
      if (!client.decr) return;
      const fullKey = makeKey(key);
      const next = await client.decr(fullKey);
      if (next <= 0) {
        await client.del(fullKey);
      }
    },
    async resetKey(key: string): Promise<void> {
      await client.del(makeKey(key));
    },
  };
}

export interface RedisClusterHandle {
  enabled: boolean;
  rateLimitClient: RedisRateLimitClient | null;
  close(): Promise<void>;
}

export async function initRedisClusterFromEnv(
  io: Server,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RedisClusterHandle> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    return {
      enabled: false,
      rateLimitClient: null,
      async close() {},
    };
  }

  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("[redis] pubClient error:", error);
  });
  subClient.on("error", (error) => {
    console.error("[redis] subClient error:", error);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  return {
    enabled: true,
    rateLimitClient: pubClient as unknown as RedisRateLimitClient,
    async close() {
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    },
  };
}
