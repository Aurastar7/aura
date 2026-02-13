import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const createRedis = () =>
  createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => Math.min(100 + retries * 100, 3000),
    },
  });
