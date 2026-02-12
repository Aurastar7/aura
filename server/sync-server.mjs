import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { createPool } from './config/database.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(rootDir, '.env') });
dotenv.config({ path: path.resolve(rootDir, '.env.production') });
dotenv.config();

const port = Number(process.env.PORT || process.env.SYNC_PORT || 3001);
const corsOrigin = process.env.CORS_ORIGIN || '*';
const jwtSecret = process.env.JWT_SECRET || '';
const pool = createPool();

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const parsePagination = (req) => {
  const page = Math.max(Number(req.query.page || 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 20) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const signToken = (userId) => {
  if (!jwtSecret) throw new HttpError(500, 'JWT secret is not configured.');
  return jwt.sign({ sub: userId }, jwtSecret, { expiresIn: '7d' });
};

const pickToken = (req) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
};

const loadAuthUser = async (req) => {
  const token = pickToken(req);
  if (!token) throw new HttpError(401, 'Unauthorized.');
  if (!jwtSecret) throw new HttpError(500, 'JWT secret is not configured.');

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    throw new HttpError(401, 'Invalid token.');
  }

  const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
  if (typeof userId !== 'string') throw new HttpError(401, 'Invalid token payload.');

  const { rows } = await pool.query(
    `
      SELECT
        id,
        username,
        email,
        display_name AS "displayName",
        avatar_url AS "avatarUrl",
        bio,
        created_at AS "createdAt"
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  if (!rows[0]) throw new HttpError(401, 'User not found.');
  return rows[0];
};

const requireAuth = asyncRoute(async (req, _res, next) => {
  req.user = await loadAuthUser(req);
  next();
});

const mapPost = (row) => ({
  id: row.id,
  userId: row.userId,
  content: row.content,
  createdAt: row.createdAt,
  author: {
    id: row.authorId,
    username: row.authorUsername,
    displayName: row.authorDisplayName,
    avatarUrl: row.authorAvatarUrl,
  },
});

const mapMessage = (row) => ({
  id: row.id,
  senderId: row.senderId,
  receiverId: row.receiverId,
  content: row.content,
  createdAt: row.createdAt,
});

const wsAuthBySocket = new WeakMap();
const wss = new WebSocketServer({ noServer: true });

const sendWs = (socket, payload) => {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
};

const broadcastMessage = (payload, userIds) => {
  const ids = new Set(userIds);
  wss.clients.forEach((socket) => {
    const socketUserId = wsAuthBySocket.get(socket);
    if (!socketUserId || !ids.has(socketUserId)) return;
    sendWs(socket, payload);
  });
};

app.get(
  '/health',
  asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true });
  })
);

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || username).trim();

    if (!username || username.length < 3) throw new HttpError(400, 'Invalid username.');
    if (!email || !email.includes('@')) throw new HttpError(400, 'Invalid email.');
    if (!password || password.length < 6) throw new HttpError(400, 'Invalid password.');

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const { rows } = await pool.query(
        `
          INSERT INTO users (username, email, password_hash, display_name)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            username,
            email,
            display_name AS "displayName",
            avatar_url AS "avatarUrl",
            bio,
            created_at AS "createdAt"
        `,
        [username, email, passwordHash, displayName || username]
      );

      const user = rows[0];
      const token = signToken(user.id);
      res.status(201).json({ ok: true, token, user });
    } catch (error) {
      if (error && typeof error === 'object' && error.code === '23505') {
        throw new HttpError(409, 'Username or email already exists.');
      }
      throw error;
    }
  })
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const identity = String(req.body.username || req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!identity || !password) throw new HttpError(400, 'Missing credentials.');

    const { rows } = await pool.query(
      `
        SELECT
          id,
          username,
          email,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt"
        FROM users
        WHERE username = $1 OR email = $1
        LIMIT 1
      `,
      [identity]
    );

    const user = rows[0];
    if (!user) throw new HttpError(401, 'Invalid credentials.');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new HttpError(401, 'Invalid credentials.');

    delete user.passwordHash;
    const token = signToken(user.id);
    res.status(200).json({ ok: true, token, user });
  })
);

app.get(
  '/api/users/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.email,
          u.display_name AS "displayName",
          u.avatar_url AS "avatarUrl",
          u.bio,
          u.created_at AS "createdAt",
          COALESCE(followers.cnt, 0) AS "followersCount",
          COALESCE(following.cnt, 0) AS "followingCount"
        FROM users u
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INT AS cnt
          FROM follows
          WHERE following_id = u.id
        ) followers ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INT AS cnt
          FROM follows
          WHERE follower_id = u.id
        ) following ON TRUE
        WHERE u.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (!rows[0]) throw new HttpError(404, 'User not found.');
    res.status(200).json({ ok: true, user: rows[0] });
  })
);

app.put(
  '/api/users/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.id !== req.params.id) throw new HttpError(403, 'Forbidden.');

    const displayName = req.body.displayName !== undefined ? String(req.body.displayName).trim() : null;
    const avatarUrl = req.body.avatarUrl !== undefined ? String(req.body.avatarUrl).trim() : null;
    const bio = req.body.bio !== undefined ? String(req.body.bio) : null;

    const updates = [];
    const values = [];
    let idx = 1;

    if (displayName !== null) {
      updates.push(`display_name = $${idx}`);
      values.push(displayName);
      idx += 1;
    }
    if (avatarUrl !== null) {
      updates.push(`avatar_url = $${idx}`);
      values.push(avatarUrl);
      idx += 1;
    }
    if (bio !== null) {
      updates.push(`bio = $${idx}`);
      values.push(bio);
      idx += 1;
    }

    if (!updates.length) throw new HttpError(400, 'Nothing to update.');

    values.push(req.params.id);
    const { rows } = await pool.query(
      `
        UPDATE users
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${idx}
        RETURNING
          id,
          username,
          email,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          created_at AS "createdAt"
      `,
      values
    );

    if (!rows[0]) throw new HttpError(404, 'User not found.');
    res.status(200).json({ ok: true, user: rows[0] });
  })
);

app.post(
  '/api/posts',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const content = String(req.body.content || '').trim();
    if (!content) throw new HttpError(400, 'Post content is required.');

    const { rows } = await pool.query(
      `
        INSERT INTO posts (user_id, content)
        VALUES ($1, $2)
        RETURNING
          id,
          user_id AS "userId",
          content,
          created_at AS "createdAt"
      `,
      [actor.id, content]
    );

    const post = {
      ...rows[0],
      author: {
        id: actor.id,
        username: actor.username,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
      },
    };

    res.status(201).json({ ok: true, post });
  })
);

app.get(
  '/api/posts/feed',
  asyncRoute(async (req, res) => {
    const { page, limit, offset } = parsePagination(req);

    const { rows } = await pool.query(
      `
        SELECT
          p.id,
          p.user_id AS "userId",
          p.content,
          p.created_at AS "createdAt",
          u.id AS "authorId",
          u.username AS "authorUsername",
          u.display_name AS "authorDisplayName",
          u.avatar_url AS "authorAvatarUrl"
        FROM posts p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    res.status(200).json({ ok: true, page, limit, items: rows.map(mapPost) });
  })
);

app.post(
  '/api/follow',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const targetUserId = String(req.body.targetUserId || '').trim();
    if (!targetUserId) throw new HttpError(400, 'targetUserId is required.');
    if (targetUserId === actor.id) throw new HttpError(400, 'Cannot follow yourself.');

    const target = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
    if (!target.rows[0]) throw new HttpError(404, 'User not found.');

    await pool.query(
      `
        INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `,
      [actor.id, targetUserId]
    );

    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/messages',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const receiverId = String(req.body.receiverId || '').trim();
    const content = String(req.body.content || '').trim();

    if (!receiverId) throw new HttpError(400, 'receiverId is required.');
    if (!content) throw new HttpError(400, 'Message content is required.');
    if (receiverId === actor.id) throw new HttpError(400, 'Cannot send message to yourself.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const receiver = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [receiverId]);
      if (!receiver.rows[0]) {
        await client.query('ROLLBACK');
        throw new HttpError(404, 'Receiver not found.');
      }

      const { rows } = await client.query(
        `
          INSERT INTO messages (sender_id, receiver_id, content)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            sender_id AS "senderId",
            receiver_id AS "receiverId",
            content,
            created_at AS "createdAt"
        `,
        [actor.id, receiverId, content]
      );

      await client.query('COMMIT');

      const message = mapMessage(rows[0]);
      broadcastMessage({ type: 'message:new', message }, [actor.id, receiverId]);

      res.status(201).json({ ok: true, message });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

app.get(
  '/api/messages/:userId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const otherUserId = req.params.userId;
    const { page, limit, offset } = parsePagination(req);

    const { rows } = await pool.query(
      `
        SELECT
          id,
          sender_id AS "senderId",
          receiver_id AS "receiverId",
          content,
          created_at AS "createdAt"
        FROM messages
        WHERE
          (sender_id = $1 AND receiver_id = $2)
          OR
          (sender_id = $2 AND receiver_id = $1)
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `,
      [actor.id, otherUserId, limit, offset]
    );

    res.status(200).json({ ok: true, page, limit, items: rows.map(mapMessage) });
  })
);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: 'Not found.' });
});

app.use((error, _req, res, _next) => {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof HttpError ? error.message : 'Internal server error.';
  res.status(statusCode).json({ ok: false, message });
});

const server = createServer(app);

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  ws.isAlive = true;

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const token = url.searchParams.get('token');
  if (token && jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
      if (typeof userId === 'string') wsAuthBySocket.set(ws, userId);
    } catch {
      // ignore invalid token
    }
  }

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      if (payload?.type === 'auth' && typeof payload.token === 'string' && jwtSecret) {
        const decoded = jwt.verify(payload.token, jwtSecret);
        const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
        if (typeof userId === 'string') {
          wsAuthBySocket.set(ws, userId);
          sendWs(ws, { type: 'auth:ok' });
          return;
        }
      }
      sendWs(ws, { type: 'noop' });
    } catch {
      sendWs(ws, { type: 'error', message: 'Bad websocket payload.' });
    }
  });

  ws.on('close', () => {
    wsAuthBySocket.delete(ws);
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

server.listen(port);

const shutdown = async () => {
  clearInterval(heartbeat);
  wss.clients.forEach((socket) => socket.close());
  await new Promise((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
