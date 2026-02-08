import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { WebSocketServer } from 'ws';

const port = Number(process.env.SYNC_PORT || 3001);
const dbUrl = process.env.DATABASE_URL;
const legacyJsonFile = path.resolve(process.cwd(), 'server', 'data', 'sync-db.json');

if (!dbUrl) {
  console.error('DATABASE_URL is required. Example: postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const now = () => new Date().toISOString();

const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
});

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

const ensureSchema = async () => {
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

const readRow = async () => {
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

const maybeImportLegacyJson = async () => {
  const current = await readRow();
  if (current.state) return;

  try {
    const raw = await fs.readFile(legacyJsonFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const state = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed;
    if (!state || typeof state !== 'object') return;

    await pool.query(
      `
        UPDATE aura_state
        SET state = $1::jsonb,
            revision = GREATEST(revision, 1),
            updated_at = NOW()
        WHERE id = 1
      `,
      [JSON.stringify(state)]
    );
    console.log('Imported legacy JSON state into PostgreSQL.');
  } catch {
    // Legacy file is optional.
  }
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
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
      const envelope = await readRow();
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
  const url = new URL(req.url || '/', 'http://localhost');
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
    const row = await readRow();
    ws.send(JSON.stringify({ type: 'hello', revision: row.revision, updatedAt: row.updatedAt }));
  } catch {
    ws.send(JSON.stringify({ type: 'hello', revision: 0, updatedAt: null }));
  }
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

const bootstrap = async () => {
  await ensureSchema();
  await maybeImportLegacyJson();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Aura sync server (PostgreSQL + WebSocket) on http://0.0.0.0:${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start sync server:', error);
  process.exit(1);
});
