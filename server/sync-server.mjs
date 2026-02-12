import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { createPool } from './config/database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(rootDir, '.env') });
dotenv.config({ path: path.resolve(rootDir, '.env.production') });
dotenv.config();

const port = Number(process.env.SYNC_PORT || process.env.PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN || '*';

const headers = {
  'Access-Control-Allow-Origin': corsOrigin,
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

const now = () => new Date().toISOString();

const pool = createPool();

const parseBody = async (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const send = (res, code, payload) => {
  res.writeHead(code, headers);
  res.end(JSON.stringify(payload));
};

const ensureStateTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aura_state (
      id SMALLINT PRIMARY KEY,
      revision BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      state JSONB
    );
  `);

  await pool.query(
    `
      INSERT INTO aura_state (id, revision, updated_at, state)
      VALUES (1, 0, NOW(), NULL)
      ON CONFLICT (id) DO NOTHING;
    `
  );
};

const readState = async () => {
  const { rows } = await pool.query(
    'SELECT revision, updated_at AS "updatedAt", state FROM aura_state WHERE id = 1 LIMIT 1'
  );
  const row = rows[0] || { revision: 0, updatedAt: null, state: null };
  return {
    revision: Number(row.revision ?? 0),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    state: row.state ?? null,
  };
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if ((req.url === '/health' || req.url === '/api/health') && req.method === 'GET') {
    try {
      await pool.query('SELECT 1');
      send(res, 200, { ok: true, service: 'aura-sync', timestamp: now(), db: 'ok' });
    } catch (error) {
      send(res, 500, { ok: false, service: 'aura-sync', timestamp: now(), db: String(error) });
    }
    return;
  }

  if (req.url === '/api/db' && req.method === 'GET') {
    try {
      const envelope = await readState();
      send(res, 200, envelope);
    } catch (error) {
      send(res, 500, { ok: false, message: String(error) });
    }
    return;
  }

  if (req.url === '/api/db' && req.method === 'PUT') {
    try {
      const raw = await parseBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const state = parsed?.state;
      const clientRevision = Number(parsed?.revision ?? 0);

      if (!state || typeof state !== 'object' || !Array.isArray(state.users)) {
        send(res, 400, { ok: false, message: 'Invalid payload.' });
        return;
      }
      if (state.users.length < 1) {
        send(res, 400, { ok: false, message: 'Refusing to persist empty users list.' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const currentRes = await client.query(
          'SELECT revision, updated_at AS "updatedAt", state FROM aura_state WHERE id = 1 FOR UPDATE'
        );
        const current = currentRes.rows[0];
        const currentRevision = Number(current?.revision ?? 0);
        if (clientRevision !== currentRevision) {
          await client.query('ROLLBACK');
          send(res, 409, {
            ok: false,
            message: 'Revision conflict.',
            state: current?.state ?? null,
            revision: currentRevision,
            updatedAt: current?.updatedAt ? new Date(current.updatedAt).toISOString() : null,
          });
          return;
        }

        const nextRes = await client.query(
          `
            UPDATE aura_state
            SET state = $1::jsonb,
                revision = revision + 1,
                updated_at = NOW()
            WHERE id = 1
            RETURNING revision, updated_at AS "updatedAt"
          `,
          [JSON.stringify(state)]
        );

        await client.query('COMMIT');

        const next = nextRes.rows[0];
        const payload = {
          ok: true,
          revision: Number(next.revision),
          updatedAt: new Date(next.updatedAt).toISOString(),
        };
        send(res, 200, payload);

        broadcast({
          type: 'db:updated',
          revision: payload.revision,
          updatedAt: payload.updatedAt,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      send(res, 500, { ok: false, message: String(error) });
    }
    return;
  }

  send(res, 404, { ok: false, message: 'Not found' });
});

const wss = new WebSocketServer({ noServer: true });

const broadcast = (payload) => {
  const raw = JSON.stringify(payload);
  wss.clients.forEach((socket) => {
    if (socket.readyState === 1) {
      socket.send(raw);
    }
  });
};

server.on('upgrade', (req, socket, head) => {
  const baseHost = req.headers.host || '127.0.0.1';
  const url = new URL(req.url || '/', `http://${baseHost}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  try {
    const row = await readState();
    ws.send(JSON.stringify({ type: 'hello', revision: row.revision, updatedAt: row.updatedAt }));
  } catch {
    ws.send(JSON.stringify({ type: 'hello', revision: 0, updatedAt: null }));
  }
});

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

let shuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(heartbeatTimer);

  try {
    wss.clients.forEach((client) => client.close(1001, signal));
    wss.close();
  } catch {
    // ignore
  }

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  try {
    await pool.end();
  } catch {
    // ignore
  }

  process.exit(0);
};

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch(() => process.exit(1));
});

const bootstrap = async () => {
  await ensureStateTable();

  server.listen(port, '0.0.0.0', () => {
    console.log(`Aura sync server running on 0.0.0.0:${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start sync server:', error);
  process.exit(1);
});
