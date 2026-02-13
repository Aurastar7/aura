import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { WebSocketServer } from 'ws';
import { validate as isUUID } from 'uuid';
import { createPool } from './config/database.mjs';
import { createRedis } from './config/redis.mjs';
import { createMailer } from './config/mailer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(rootDir, '.env') });
dotenv.config({ path: path.resolve(rootDir, '.env.production') });
dotenv.config();

const port = Number(process.env.PORT || process.env.SYNC_PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || '';
const nodeEnv = process.env.NODE_ENV || 'development';
const verificationRequired = String(process.env.EMAIL_VERIFICATION_REQUIRED || 'true') !== 'false';
const mailFrom = process.env.MAIL_FROM || 'Aura Social <no-reply@aura.local>';

const toInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const GLOBAL_RATE_MAX = toInt(process.env.RATE_LIMIT_GLOBAL_MAX, 100);
const AUTH_RATE_MAX = toInt(process.env.RATE_LIMIT_AUTH_MAX, 5);
const FEED_LIMIT_MAX = toInt(process.env.FEED_LIMIT_MAX, 50);

const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const pool = createPool();
const redis = createRedis();
const mailer = createMailer();

let redisReady = false;

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const parsePagination = (req) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20) || 20, 1), FEED_LIMIT_MAX);
  const offset = Math.max(Number(req.query.offset || 0) || 0, 0);
  const page = Math.floor(offset / limit) + 1;
  return { limit, offset, page };
};

const sendJsonError = (res, status, message, details) => {
  res.status(status).json({ ok: false, message, details });
};

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isUsername = (value) => /^[a-zA-Z0-9_.-]{3,32}$/.test(value);
const sanitize = (value) => String(value ?? '').trim();

const signToken = (userId) => {
  if (!jwtSecret) throw new HttpError(500, 'JWT secret is not configured.');
  return jwt.sign({ sub: userId }, jwtSecret, { expiresIn: '7d' });
};

const parseBearer = (req) => {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
};

const parseAuthUserId = (req) => {
  const token = parseBearer(req);
  if (!token || !jwtSecret) return null;
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
};

const loadUserById = async (userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        username,
        email,
        display_name AS "displayName",
        avatar_url AS "avatarUrl",
        bio,
        is_verified AS "isVerified",
        email_verification_required AS "emailVerificationRequired",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
};

const requireAuth = asyncRoute(async (req, _res, next) => {
  const userId = parseAuthUserId(req);
  if (!userId) throw new HttpError(401, 'Unauthorized.');
  const user = await loadUserById(userId);
  if (!user) throw new HttpError(401, 'User not found.');
  req.user = user;
  next();
});

const sixDigitCode = () => String(Math.floor(100000 + Math.random() * 900000));

const sendCodeEmail = async (to, subject, code) => {
  await mailer.sendMail({
    from: mailFrom,
    to,
    subject,
    text: `Your Aura Social verification code is: ${code}`,
    html: `<p>Your Aura Social verification code is:</p><h2>${code}</h2>`,
  });
};

const redisSetWithTtl = async (key, value, seconds) => {
  if (!redisReady) return;
  await redis.setEx(key, seconds, value);
};

const redisGet = async (key) => {
  if (!redisReady) return null;
  return redis.get(key);
};

const redisDel = async (key) => {
  if (!redisReady) return;
  await redis.del(key);
};

const withTransaction = async (work) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const cacheFeedKey = (userId, page, limit) => `feed:${userId}:${page}:${limit}`;
const cacheFeedSetKey = (userId) => `feedkeys:${userId}`;

const setCachedFeed = async (userId, page, limit, payload) => {
  if (!redisReady) return;
  const key = cacheFeedKey(userId, page, limit);
  await redis.setEx(key, 30, JSON.stringify(payload));
  await redis.sAdd(cacheFeedSetKey(userId), key);
  await redis.expire(cacheFeedSetKey(userId), 60);
};

const getCachedFeed = async (userId, page, limit) => {
  if (!redisReady) return null;
  const raw = await redis.get(cacheFeedKey(userId, page, limit));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const invalidateFeedCacheForUsers = async (userIds) => {
  if (!redisReady || !userIds.length) return;

  for (const userId of userIds) {
    const setKey = cacheFeedSetKey(userId);
    const keys = await redis.sMembers(setKey);
    if (keys.length) {
      await redis.del(keys);
    }
    await redis.del(setKey);
  }
};

const mapPostRow = (row) => ({
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

const mapMessageRow = (row) => ({
  id: row.id,
  senderId: row.senderId,
  receiverId: row.receiverId,
  content: row.content,
  createdAt: row.createdAt,
});

const wsAuthBySocket = new WeakMap();
const wss = new WebSocketServer({ noServer: true });

const wsSend = (socket, payload) => {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
};

const wsBroadcastMessage = (message) => {
  const recipients = new Set([message.senderId, message.receiverId]);
  wss.clients.forEach((socket) => {
    const socketUserId = wsAuthBySocket.get(socket);
    if (!socketUserId || !recipients.has(socketUserId)) return;
    wsSend(socket, { type: 'message:new', message });
  });
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, 'CORS origin denied.'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));

const limiterStore = new RedisStore({
  sendCommand: (...args) => redis.sendCommand(args),
});

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: GLOBAL_RATE_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: limiterStore,
  })
);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AUTH_RATE_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: limiterStore,
});

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true, status: 'healthy' });
  })
);

app.post(
  '/api/auth/register',
  authLimiter,
  asyncRoute(async (req, res) => {
    const username = sanitize(req.body.username).toLowerCase();
    const email = sanitize(req.body.email || `${username}@aura.local`).toLowerCase();
    const displayName = sanitize(req.body.displayName || username);
    const password = String(req.body.password || '');

    if (!isUsername(username)) throw new HttpError(400, 'Username must be 3-32 chars.');
    if (!isEmail(email)) throw new HttpError(400, 'Invalid email address.');
    if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 chars.');

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      try {
        const inserted = await client.query(
          `
            INSERT INTO users (
              username,
              email,
              password_hash,
              display_name,
              is_verified,
              email_verification_required
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, email
          `,
          [username, email, passwordHash, displayName || username, !verificationRequired, verificationRequired]
        );
        return inserted.rows[0];
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          throw new HttpError(409, 'Username or email already exists.');
        }
        throw error;
      }
    });

    if (verificationRequired) {
      const code = sixDigitCode();
      await redisSetWithTtl(`verify:${user.id}`, code, 600);
      await sendCodeEmail(user.email, 'Verify your Aura Social account', code);
      res.status(201).json({ ok: true, requiresVerification: true, userId: user.id });
      return;
    }

    const fullUser = await loadUserById(user.id);
    const token = signToken(user.id);
    res.status(201).json({ ok: true, requiresVerification: false, token, user: fullUser });
  })
);

app.post(
  '/api/auth/verify',
  authLimiter,
  asyncRoute(async (req, res) => {
    const userId = sanitize(req.body.userId);
    const code = sanitize(req.body.code);

    if (!userId || !code) throw new HttpError(400, 'userId and code are required.');

    const stored = await redisGet(`verify:${userId}`);
    if (!stored || stored !== code) throw new HttpError(400, 'Invalid verification code.');

    await pool.query(
      `
        UPDATE users
        SET is_verified = TRUE,
            email_verification_required = FALSE,
            updated_at = NOW()
        WHERE id = $1
      `,
      [userId]
    );

    await redisDel(`verify:${userId}`);

    const user = await loadUserById(userId);
    if (!user) throw new HttpError(404, 'User not found.');

    const token = signToken(userId);
    res.status(200).json({ ok: true, token, user });
  })
);

app.post(
  '/api/auth/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    const identity = sanitize(req.body.email || req.body.username).toLowerCase();
    const password = String(req.body.password || '');

    if (!identity || !password) throw new HttpError(400, 'Missing credentials.');

    const { rows } = await pool.query(
      `
        SELECT
          id,
          username,
          email,
          password_hash AS "passwordHash",
          is_verified AS "isVerified"
        FROM users
        WHERE username = $1 OR email = $1
        LIMIT 1
      `,
      [identity]
    );

    const user = rows[0];
    if (!user) throw new HttpError(401, 'Invalid credentials.');

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new HttpError(401, 'Invalid credentials.');
    if (!user.isVerified) {
      res.status(403).json({ ok: false, message: 'Email not verified.', requiresVerification: true, userId: user.id });
      return;
    }

    const fullUser = await loadUserById(user.id);
    const token = signToken(user.id);
    res.status(200).json({ ok: true, token, user: fullUser });
  })
);

app.get(
  '/api/users/:id',
  asyncRoute(async (req, res) => {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.display_name AS "displayName",
          u.avatar_url AS "avatarUrl",
          u.bio,
          u.is_verified AS "isVerified",
          u.created_at AS "createdAt",
          COALESCE(followers.count, 0) AS "followersCount",
          COALESCE(following.count, 0) AS "followingCount"
        FROM users u
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INT AS count FROM follows WHERE following_id = u.id
        ) followers ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INT AS count FROM follows WHERE follower_id = u.id
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

app.get(
  '/api/users/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    res.status(200).json({ ok: true, user: actor });
  })
);

app.get(
  '/api/users',
  asyncRoute(async (req, res) => {
    const { limit, offset, page } = parsePagination(req);
    const query = sanitize(req.query.q || '').toLowerCase();

    if (query) {
      const { rows } = await pool.query(
        `
          SELECT
            id,
            username,
            display_name AS "displayName",
            avatar_url AS "avatarUrl",
            bio,
            is_verified AS "isVerified",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM users
          WHERE LOWER(username::TEXT) LIKE $1 OR LOWER(display_name) LIKE $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `,
        [`%${query}%`, limit, offset]
      );
      res.status(200).json({ ok: true, page, limit, offset, items: rows });
      return;
    }

    const { rows } = await pool.query(
      `
        SELECT
          id,
          username,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          is_verified AS "isVerified",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    res.status(200).json({ ok: true, page, limit, offset, items: rows });
  })
);

app.put(
  '/api/users/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const displayName = req.body.displayName !== undefined ? sanitize(req.body.displayName) : null;
    const avatarUrl = req.body.avatarUrl !== undefined ? sanitize(req.body.avatarUrl) : null;
    const bio = req.body.bio !== undefined ? String(req.body.bio || '') : null;

    const updates = [];
    const values = [];
    let index = 1;

    if (displayName !== null) {
      updates.push(`display_name = $${index}`);
      values.push(displayName);
      index += 1;
    }
    if (avatarUrl !== null) {
      updates.push(`avatar_url = $${index}`);
      values.push(avatarUrl || null);
      index += 1;
    }
    if (bio !== null) {
      updates.push(`bio = $${index}`);
      values.push(bio);
      index += 1;
    }

    if (!updates.length) throw new HttpError(400, 'Nothing to update.');

    values.push(actor.id);

    const { rows } = await pool.query(
      `
        UPDATE users
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${index}
        RETURNING
          id,
          username,
          email,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          is_verified AS "isVerified",
          email_verification_required AS "emailVerificationRequired",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      values
    );

    res.status(200).json({ ok: true, user: rows[0] });
  })
);

app.put(
  '/api/users/change-password',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || newPassword.length < 6) {
      throw new HttpError(400, 'Invalid password payload.');
    }

    const { rows } = await pool.query(
      'SELECT password_hash AS "passwordHash" FROM users WHERE id = $1 LIMIT 1',
      [actor.id]
    );

    const current = rows[0];
    if (!current) throw new HttpError(404, 'User not found.');

    const valid = await bcrypt.compare(currentPassword, current.passwordHash);
    if (!valid) throw new HttpError(401, 'Current password is incorrect.');

    const nextHash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `
        UPDATE users
        SET password_hash = $1,
            password_changed_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
      `,
      [nextHash, actor.id]
    );

    res.status(200).json({ ok: true, message: 'Password updated.' });
  })
);

app.post(
  '/api/users/request-email-change',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const newEmail = sanitize(req.body.newEmail).toLowerCase();
    if (!isEmail(newEmail)) throw new HttpError(400, 'Invalid email.');

    const conflict = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [newEmail]);
    if (conflict.rows[0]) throw new HttpError(409, 'Email already in use.');

    const code = sixDigitCode();
    await redisSetWithTtl(
      `change-email:${actor.id}`,
      JSON.stringify({ newEmail, code }),
      600
    );
    await sendCodeEmail(newEmail, 'Confirm your new Aura Social email', code);

    res.status(200).json({ ok: true, message: 'Confirmation code sent.' });
  })
);

app.post(
  '/api/users/confirm-email-change',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const code = sanitize(req.body.code);
    if (!code) throw new HttpError(400, 'Code is required.');

    const raw = await redisGet(`change-email:${actor.id}`);
    if (!raw) throw new HttpError(400, 'Code expired.');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Invalid email change payload.');
    }

    if (parsed.code !== code) throw new HttpError(400, 'Invalid confirmation code.');

    try {
      await pool.query(
        `
          UPDATE users
          SET email = $1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [parsed.newEmail, actor.id]
      );
    } catch (error) {
      if (error && typeof error === 'object' && error.code === '23505') {
        throw new HttpError(409, 'Email already in use.');
      }
      throw error;
    }

    await redisDel(`change-email:${actor.id}`);

    const user = await loadUserById(actor.id);
    res.status(200).json({ ok: true, user });
  })
);

app.get(
  '/api/users/:id/posts',
  asyncRoute(async (req, res) => {
    if (!isUUID(req.params.id)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    const { limit, offset, page } = parsePagination(req);
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
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [req.params.id, limit, offset]
    );

    res.status(200).json({ ok: true, page, limit, items: rows.map(mapPostRow) });
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

    const { rows: followerRows } = await pool.query(
      'SELECT follower_id AS "followerId" FROM follows WHERE following_id = $1',
      [actor.id]
    );
    const cacheTargets = [actor.id, ...followerRows.map((item) => item.followerId)];
    await invalidateFeedCacheForUsers(cacheTargets);

    res.status(201).json({ ok: true, post });
  })
);

app.get(
  '/api/posts/feed',
  asyncRoute(async (req, res) => {
    const { limit, offset, page } = parsePagination(req);
    const authUserId = parseAuthUserId(req) || 'guest';

    const cached = await getCachedFeed(authUserId, page, limit);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

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

    const payload = {
      ok: true,
      page,
      limit,
      offset,
      items: rows.map(mapPostRow),
    };

    await setCachedFeed(authUserId, page, limit, payload);
    res.status(200).json(payload);
  })
);

app.delete(
  '/api/posts/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const post = await pool.query('SELECT user_id AS "userId" FROM posts WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!post.rows[0]) throw new HttpError(404, 'Post not found.');
    if (post.rows[0].userId !== actor.id) throw new HttpError(403, 'Forbidden.');

    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);

    const { rows: followerRows } = await pool.query(
      'SELECT follower_id AS "followerId" FROM follows WHERE following_id = $1',
      [actor.id]
    );
    const cacheTargets = [actor.id, ...followerRows.map((item) => item.followerId)];
    await invalidateFeedCacheForUsers(cacheTargets);

    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/follow/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const targetId = req.params.id;
    if (!targetId) throw new HttpError(400, 'Target id is required.');
    if (targetId === actor.id) throw new HttpError(400, 'Cannot follow yourself.');

    const target = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetId]);
    if (!target.rows[0]) throw new HttpError(404, 'User not found.');

    await pool.query(
      `
        INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `,
      [actor.id, targetId]
    );

    res.status(200).json({ ok: true });
  })
);

app.delete(
  '/api/follow/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const targetId = req.params.id;
    if (!targetId) throw new HttpError(400, 'Target id is required.');

    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [
      actor.id,
      targetId,
    ]);

    res.status(200).json({ ok: true });
  })
);

app.get(
  '/api/follows/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const { rows } = await pool.query(
      `
        SELECT
          gen_random_uuid()::TEXT AS id,
          follower_id AS "followerId",
          following_id AS "followingId",
          created_at AS "createdAt"
        FROM follows
        WHERE follower_id = $1
      `,
      [actor.id]
    );
    res.status(200).json({ ok: true, items: rows });
  })
);

app.post(
  '/api/follow',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const targetId = sanitize(req.body.targetUserId);
    if (!targetId) throw new HttpError(400, 'targetUserId is required.');
    if (targetId === actor.id) throw new HttpError(400, 'Cannot follow yourself.');

    const target = await pool.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetId]);
    if (!target.rows[0]) throw new HttpError(404, 'User not found.');

    await pool.query(
      `
        INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
      `,
      [actor.id, targetId]
    );

    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/messages',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const receiverId = sanitize(req.body.receiverId);
    const content = String(req.body.content || req.body.text || '').trim();

    if (!receiverId) throw new HttpError(400, 'receiverId is required.');
    if (!content) throw new HttpError(400, 'content is required.');
    if (receiverId === actor.id) throw new HttpError(400, 'Cannot send message to yourself.');

    const message = await withTransaction(async (client) => {
      const receiver = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [receiverId]);
      if (!receiver.rows[0]) throw new HttpError(404, 'Receiver not found.');

      const inserted = await client.query(
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

      return mapMessageRow(inserted.rows[0]);
    });

    wsBroadcastMessage(message);
    res.status(201).json({ ok: true, message });
  })
);

app.get(
  '/api/messages/:userId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const otherUserId = req.params.userId;
    const { limit, offset, page } = parsePagination(req);

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

    res.status(200).json({ ok: true, page, limit, offset, items: rows.map(mapMessageRow) });
  })
);

app.use((_req, res) => {
  res.status(404).json({ ok: false, message: 'Not found.' });
});

app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) {
    sendJsonError(res, error.statusCode, error.message, error.details);
    return;
  }

  if (nodeEnv !== 'production') {
    sendJsonError(res, 500, 'Internal server error.', { raw: String(error?.message || error) });
    return;
  }

  sendJsonError(res, 500, 'Internal server error.');
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
      if (payload?.type !== 'auth' || typeof payload.token !== 'string') return;
      if (!jwtSecret) return;

      const decoded = jwt.verify(payload.token, jwtSecret);
      const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
      if (typeof userId === 'string') {
        wsAuthBySocket.set(ws, userId);
        wsSend(ws, { type: 'auth:ok' });
      }
    } catch {
      wsSend(ws, { type: 'error', message: 'Bad websocket payload.' });
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

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(heartbeat);

  wss.clients.forEach((socket) => socket.close());
  await new Promise((resolve) => server.close(resolve));

  if (redisReady) {
    try {
      await redis.quit();
    } catch {
      // ignore redis shutdown errors
    }
  }

  await pool.end();
  process.exit(0);
};

const start = async () => {
  try {
    await redis.connect();
    redisReady = true;
  } catch {
    throw new Error('Redis connection failed.');
  }

  server.listen(port);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

start().catch(async () => {
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
