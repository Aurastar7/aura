import { Pool, PoolConfig } from 'pg';

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const dbConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || '127.0.0.1',
  port: toInt(process.env.PGPORT, 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: false,
  max: toInt(process.env.PGPOOL_MAX, 20),
  idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 10000),
  connectionTimeoutMillis: toInt(process.env.PG_CONNECT_TIMEOUT_MS, 2000),
  maxUses: toInt(process.env.PG_MAX_USES, 7500),
};

export const createPool = () => new Pool(dbConfig);
