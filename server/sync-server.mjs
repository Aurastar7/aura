import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
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
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || '10mb');
const verificationRequired = String(process.env.EMAIL_VERIFICATION_REQUIRED || 'true') !== 'false';
const mailFrom = process.env.MAIL_FROM || 'Aura Social <no-reply@aura.local>';
const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const ADMIN_ROLES = new Set(['user', 'moderator', 'curator', 'admin']);

const toInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const GLOBAL_RATE_MAX = toInt(process.env.RATE_LIMIT_GLOBAL_MAX, 100);
const AUTH_RATE_MAX = toInt(process.env.RATE_LIMIT_AUTH_MAX, 5);
const FEED_LIMIT_MAX = toInt(process.env.FEED_LIMIT_MAX, 50);
const FEED_CACHE_TTL_SEC = toInt(process.env.FEED_CACHE_TTL_SEC, 45);
const FEED_CACHE_INDEX_TTL_SEC = toInt(process.env.FEED_CACHE_INDEX_TTL_SEC, 120);
const CHAT_LIST_CACHE_TTL_SEC = toInt(process.env.CHAT_LIST_CACHE_TTL_SEC, 12);
const EMAIL_CODE_TTL_SEC = toInt(process.env.EMAIL_CODE_TTL_SEC, 600);
const EMAIL_CODE_MAX_ATTEMPTS = toInt(process.env.EMAIL_CODE_MAX_ATTEMPTS, 10);
const EMAIL_CODE_PEPPER = String(process.env.EMAIL_CODE_PEPPER || jwtSecret || 'aura-email-code');
const WS_MESSAGE_CHANNEL = String(process.env.REDIS_WS_CHANNEL || 'aura:ws:message').trim();
const BOOTSTRAP_ADMIN_ENABLED = String(process.env.BOOTSTRAP_ADMIN_ENABLED || 'true') !== 'false';
const BOOTSTRAP_ADMIN_USERNAME = String(process.env.BOOTSTRAP_ADMIN_USERNAME || '313').trim().toLowerCase();
const BOOTSTRAP_ADMIN_PASSWORD = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '313');
const BOOTSTRAP_ADMIN_EMAIL = String(
  process.env.BOOTSTRAP_ADMIN_EMAIL || `${BOOTSTRAP_ADMIN_USERNAME}@aura.local`
)
  .trim()
  .toLowerCase();
const BOOTSTRAP_ADMIN_DISPLAY_NAME = String(
  process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Aura Admin'
).trim();

const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const pool = createPool();
const redis = createRedis();
const redisSubscriber = redis.duplicate();
const mailer = createMailer();

let redisReady = false;
let redisPubSubReady = false;

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
const verifyPassword = async (plainPassword, storedHash) => {
  if (!storedHash) return { ok: false, legacyPlain: false };
  try {
    const ok = await bcrypt.compare(plainPassword, storedHash);
    if (ok) return { ok: true, legacyPlain: false };
  } catch {
    // ignore invalid hash format and fallback to legacy check
  }
  if (storedHash === plainPassword) return { ok: true, legacyPlain: true };
  return { ok: false, legacyPlain: false };
};
const isAdminUser = (user) =>
  Boolean(user && (user.role === 'admin' || adminEmails.has(String(user.email || '').toLowerCase())));
const sortUuidPair = (left, right) => (left <= right ? [left, right] : [right, left]);

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
        status,
        cover_image_url AS "coverImage",
        hidden_from_friends AS "hiddenFromFriends",
        role,
        banned,
        restricted,
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
  if (user.banned) throw new HttpError(403, 'Account is banned.');
  req.user = user;
  next();
});

const requireAdmin = (req, _res, next) => {
  if (!isAdminUser(req.user)) {
    next(new HttpError(403, 'Admin access required.'));
    return;
  }
  next();
};

const sixDigitCode = () => String(Math.floor(100000 + Math.random() * 900000));
const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
const hashEmailCode = (userId, purpose, code) =>
  crypto
    .createHmac('sha256', EMAIL_CODE_PEPPER)
    .update(`${userId}:${purpose}:${code}`)
    .digest('hex');

const sendCodeEmail = async (to, subject, code) => {
  await mailer.sendMail({
    from: mailFrom,
    to,
    subject,
    text: `Your Aura Social verification code is: ${code}`,
    html: `<p>Your Aura Social verification code is:</p><h2>${code}</h2>`,
  });
};

const saveEmailCode = async ({ userId, purpose, code, targetEmail = null }) => {
  const codeHash = hashEmailCode(userId, purpose, code);
  await pool.query(
    `
      INSERT INTO email_verification_codes (
        user_id,
        purpose,
        code_hash,
        target_email,
        attempts,
        expires_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        0,
        NOW() + ($5::INT * INTERVAL '1 second'),
        NOW()
      )
      ON CONFLICT (user_id, purpose)
      DO UPDATE
        SET code_hash = EXCLUDED.code_hash,
            target_email = EXCLUDED.target_email,
            attempts = 0,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
    `,
    [userId, purpose, codeHash, targetEmail, EMAIL_CODE_TTL_SEC]
  );
};

const consumeEmailCode = async ({ userId, purpose, code }) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        SELECT
          code_hash AS "codeHash",
          target_email AS "targetEmail",
          expires_at AS "expiresAt",
          attempts
        FROM email_verification_codes
        WHERE user_id = $1 AND purpose = $2
        FOR UPDATE
      `,
      [userId, purpose]
    );

    const row = rows[0];
    if (!row) return { ok: false, reason: 'missing' };
    const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      await client.query(
        'DELETE FROM email_verification_codes WHERE user_id = $1 AND purpose = $2',
        [userId, purpose]
      );
      return { ok: false, reason: 'expired' };
    }

    const incomingHash = hashEmailCode(userId, purpose, code);
    if (!safeEqual(row.codeHash, incomingHash)) {
      const nextAttempts = Number(row.attempts || 0) + 1;
      if (nextAttempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await client.query(
          'DELETE FROM email_verification_codes WHERE user_id = $1 AND purpose = $2',
          [userId, purpose]
        );
      } else {
        await client.query(
          `
            UPDATE email_verification_codes
            SET attempts = $3,
                updated_at = NOW()
            WHERE user_id = $1 AND purpose = $2
          `,
          [userId, purpose, nextAttempts]
        );
      }
      return { ok: false, reason: 'mismatch' };
    }

    await client.query('DELETE FROM email_verification_codes WHERE user_id = $1 AND purpose = $2', [
      userId,
      purpose,
    ]);
    return { ok: true, targetEmail: row.targetEmail || null };
  });

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const schemaFilePath = path.resolve(rootDir, 'server', 'db', 'schema.sql');
const legacyStatePath = path.resolve(rootDir, 'server', 'data', 'sync-db.json');

const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''));

const readLegacySeedUser = async () => {
  try {
    const raw = await fs.readFile(legacyStatePath, 'utf8');
    if (!raw.trim()) return null;

    const parsed = JSON.parse(raw);
    const state =
      parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object'
        ? parsed.state
        : parsed;

    const firstUser = Array.isArray(state?.users) ? state.users[0] : null;
    if (!firstUser || typeof firstUser !== 'object') return null;

    const username = sanitize(firstUser.username).toLowerCase();
    const password = String(firstUser.password || '');
    if (!isUsername(username) || password.length < 3) return null;

    const emailRaw = sanitize(firstUser.email || `${username}@aura.local`).toLowerCase();
    const email = isEmail(emailRaw) ? emailRaw : `${username}@aura.local`;
    const displayName = sanitize(firstUser.displayName || username);
    const candidateRole = sanitize(firstUser.role || '').toLowerCase();
    const role = ADMIN_ROLES.has(candidateRole) ? candidateRole : 'admin';

    return { username, password, email, displayName, role };
  } catch {
    return null;
  }
};

const ensureDatabaseSchema = async () => {
  const schemaSql = await fs.readFile(schemaFilePath, 'utf8');
  await pool.query(schemaSql);
};

const ensureDatabaseSchemaWithClient = async (client) => {
  const schemaSql = await fs.readFile(schemaFilePath, 'utf8');
  await client.query(schemaSql);
};

const ensureBootstrapAdminWithClient = async (client) => {
  if (!BOOTSTRAP_ADMIN_ENABLED) return;

  const { rows } = await client.query('SELECT COUNT(*)::INT AS total FROM users');
  const totalUsers = Number(rows[0]?.total || 0);
  if (totalUsers > 0) return;

  const legacy = await readLegacySeedUser();
  const seed = legacy || {
    username: BOOTSTRAP_ADMIN_USERNAME,
    password: BOOTSTRAP_ADMIN_PASSWORD,
    email: BOOTSTRAP_ADMIN_EMAIL,
    displayName: BOOTSTRAP_ADMIN_DISPLAY_NAME,
    role: 'admin',
  };

  const username = sanitize(seed.username).toLowerCase();
  const email = sanitize(seed.email || `${username}@aura.local`).toLowerCase();
  const displayName = sanitize(seed.displayName || username);
  const role = ADMIN_ROLES.has(seed.role) ? seed.role : 'admin';
  const passwordRaw = String(seed.password || '');
  if (!isUsername(username) || !isEmail(email) || passwordRaw.length < 3) return;

  const passwordHash = isBcryptHash(passwordRaw)
    ? passwordRaw
    : await bcrypt.hash(passwordRaw, 12);

  await client.query(
    `
      INSERT INTO users (
        username,
        email,
        password_hash,
        display_name,
        role,
        is_verified,
        email_verification_required
      )
      VALUES ($1, $2, $3, $4, $5, TRUE, FALSE)
      ON CONFLICT (username) DO NOTHING
    `,
    [username, email, passwordHash, displayName || username, role]
  );
};

const INIT_LOCK_KEY_A = 1096048961; // 'AURA' in ASCII
const INIT_LOCK_KEY_B = 1397701964; // 'SOCL' in ASCII

const ensureDatabaseReady = async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [INIT_LOCK_KEY_A, INIT_LOCK_KEY_B]
    );

    if (rows[0]?.locked) {
      try {
        await ensureDatabaseSchemaWithClient(client);
        await ensureBootstrapAdminWithClient(client);
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [INIT_LOCK_KEY_A, INIT_LOCK_KEY_B]);
        } catch {
          // ignore unlock errors
        }
      }
      return;
    }

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const { rows: readyRows } = await client.query(
          "SELECT to_regclass('public.users') IS NOT NULL AS ok"
        );
        if (readyRows[0]?.ok) return;
      } catch {
        // ignore schema probing errors
      }
      await sleep(250);
    }

    // If initialization stalled, take the lock and finish it ourselves.
    await client.query('SELECT pg_advisory_lock($1, $2)', [INIT_LOCK_KEY_A, INIT_LOCK_KEY_B]);
    try {
      await ensureDatabaseSchemaWithClient(client);
      await ensureBootstrapAdminWithClient(client);
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [INIT_LOCK_KEY_A, INIT_LOCK_KEY_B]);
      } catch {
        // ignore unlock errors
      }
    }
  } finally {
    client.release();
  }
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const toSqlLiteral = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  if (Buffer.isBuffer(value)) return `decode('${value.toString('hex')}', 'hex')`;
  if (Array.isArray(value)) return `ARRAY[${value.map((item) => toSqlLiteral(item)).join(', ')}]`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

const tablePriority = (tableName) => {
  const map = new Map([
    ['users', 10],
    ['dialogs', 20],
    ['dialog_members', 30],
    ['follows', 40],
    ['posts', 50],
    ['messages', 60],
  ]);
  return map.get(tableName) ?? 1000;
};

const createFallbackSqlDump = async () => {
  const schemaPath = path.resolve(rootDir, 'server', 'db', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  const { rows: tables } = await pool.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `
  );

  const orderedTables = tables
    .map((item) => item.tablename)
    .sort((left, right) => {
      const byPriority = tablePriority(left) - tablePriority(right);
      if (byPriority !== 0) return byPriority;
      return left.localeCompare(right);
    });

  const lines = [];
  lines.push('-- Aura Social SQL export');
  lines.push(`-- Generated at ${new Date().toISOString()}`);
  lines.push('');
  lines.push(schemaSql.trim());
  lines.push('');
  lines.push('BEGIN;');

  if (orderedTables.length) {
    lines.push(
      `TRUNCATE TABLE ${orderedTables.map((tableName) => quoteIdentifier(tableName)).join(', ')} RESTART IDENTITY CASCADE;`
    );
  }

  for (const tableName of orderedTables) {
    const { rows: columnRows } = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
      [tableName]
    );

    const columns = columnRows.map((item) => item.column_name);
    if (!columns.length) continue;

    const selectColumns = columns.map((column) => quoteIdentifier(column)).join(', ');
    const { rows } = await pool.query(`SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}`);
    if (!rows.length) continue;

    lines.push('');
    lines.push(`-- Data for ${tableName}`);
    const chunkSize = 250;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const tuples = chunk.map((row) => {
        const values = columns.map((column) => toSqlLiteral(row[column]));
        return `(${values.join(', ')})`;
      });
      lines.push(
        `INSERT INTO ${quoteIdentifier(tableName)} (${columns
          .map((column) => quoteIdentifier(column))
          .join(', ')}) VALUES\n${tuples.join(',\n')};`
      );
    }
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');

  return lines.join('\n');
};

const runPgDump = async () =>
  new Promise((resolve, reject) => {
    const args = ['--inserts', '--no-owner', '--no-privileges', '--encoding=UTF8'];
    const env = { ...process.env };

    if (process.env.DATABASE_URL) {
      args.push(process.env.DATABASE_URL);
    } else {
      if (process.env.PGHOST) args.push('-h', process.env.PGHOST);
      if (process.env.PGPORT) args.push('-p', process.env.PGPORT);
      if (process.env.PGUSER) args.push('-U', process.env.PGUSER);
      if (process.env.PGDATABASE) {
        args.push(process.env.PGDATABASE);
      } else {
        reject(new Error('PGDATABASE is not configured.'));
        return;
      }
      if (process.env.PGPASSWORD) {
        env.PGPASSWORD = process.env.PGPASSWORD;
      }
    }

    const child = spawn('pg_dump', args, { env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
    });
  });

const createSqlDump = async () => {
  try {
    return await runPgDump();
  } catch {
    return createFallbackSqlDump();
  }
};

const ensureDirectDialog = async (client, leftUserId, rightUserId) => {
  const [userA, userB] = sortUuidPair(leftUserId, rightUserId);
  const { rows } = await client.query(
    `
      INSERT INTO dialogs (kind, direct_user_a, direct_user_b)
      VALUES ('direct', $1, $2)
      ON CONFLICT (direct_user_a, direct_user_b)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `,
    [userA, userB]
  );

  const dialogId = rows[0]?.id;
  if (!dialogId) throw new HttpError(500, 'Failed to resolve dialog.');

  await client.query(
    `
      INSERT INTO dialog_members (dialog_id, user_id)
      VALUES ($1, $2), ($1, $3)
      ON CONFLICT (dialog_id, user_id) DO NOTHING
    `,
    [dialogId, leftUserId, rightUserId]
  );

  return dialogId;
};

const cacheFeedKey = (userId, page, limit) => `feed:${userId}:${page}:${limit}`;
const cacheFeedSetKey = (userId) => `feedkeys:${userId}`;
const cacheChatsKey = (userId, page, limit) => `chats:${userId}:${page}:${limit}`;
const cacheChatsSetKey = (userId) => `chatkeys:${userId}`;

const setCachedFeed = async (userId, page, limit, payload) => {
  if (!redisReady) return;
  const key = cacheFeedKey(userId, page, limit);
  await redis.setEx(key, FEED_CACHE_TTL_SEC, JSON.stringify(payload));
  await redis.sAdd(cacheFeedSetKey(userId), key);
  await redis.expire(cacheFeedSetKey(userId), FEED_CACHE_INDEX_TTL_SEC);
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

const setCachedChats = async (userId, page, limit, payload) => {
  if (!redisReady) return;
  const key = cacheChatsKey(userId, page, limit);
  await redis.setEx(key, CHAT_LIST_CACHE_TTL_SEC, JSON.stringify(payload));
  await redis.sAdd(cacheChatsSetKey(userId), key);
  await redis.expire(cacheChatsSetKey(userId), CHAT_LIST_CACHE_TTL_SEC * 2);
};

const getCachedChats = async (userId, page, limit) => {
  if (!redisReady) return null;
  const raw = await redis.get(cacheChatsKey(userId, page, limit));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const invalidateChatsCacheForUsers = async (userIds) => {
  if (!redisReady || !userIds.length) return;
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return;

  for (const userId of uniqueUserIds) {
    const setKey = cacheChatsSetKey(userId);
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
  likedBy: Array.isArray(row.likedBy) ? row.likedBy.map((item) => String(item)) : [],
  repostedBy: Array.isArray(row.repostedBy) ? row.repostedBy.map((item) => String(item)) : [],
  author: row.authorId
    ? {
        id: row.authorId,
        username: row.authorUsername,
        displayName: row.authorDisplayName,
        avatarUrl: row.authorAvatarUrl,
        bio: row.authorBio,
        status: row.authorStatus,
        coverImage: row.authorCoverImage,
        hiddenFromFriends: row.authorHiddenFromFriends,
        role: row.authorRole,
        banned: row.authorBanned,
        restricted: row.authorRestricted,
        isVerified: row.authorIsVerified,
        createdAt: row.authorCreatedAt,
        updatedAt: row.authorUpdatedAt,
      }
    : null,
});

const mapPostCommentRow = (row) => ({
  id: row.id,
  postId: row.postId,
  authorId: row.authorId,
  text: row.text,
  likedBy: Array.isArray(row.likedBy) ? row.likedBy.map((item) => String(item)) : [],
  createdAt: row.createdAt,
});

const mapMessageRow = (row) => ({
  id: row.id,
  dialogId: row.dialogId,
  senderId: row.senderId,
  receiverId: row.receiverId,
  content: row.content,
  readAt: row.readAt,
  editedAt: row.editedAt,
  createdAt: row.createdAt,
});

const mapGroupRow = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  adminId: row.adminId,
  allowMemberPosts: row.allowMemberPosts,
  avatar: row.avatar,
  coverImage: row.coverImage,
  verified: row.verified,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapGroupMemberRow = (row) => ({
  id: row.id,
  groupId: row.groupId,
  userId: row.userId,
  role: row.role,
  createdAt: row.createdAt,
});

const normalizeUuidArray = (value) =>
  Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

const mapGroupPostRow = (row) => ({
  id: row.id,
  groupId: row.groupId,
  authorId: row.authorId,
  text: row.text,
  mediaType: row.mediaType || undefined,
  mediaUrl: row.mediaUrl || undefined,
  repostOfPostId: row.repostOfPostId || undefined,
  createdAt: row.createdAt,
  likedBy: normalizeUuidArray(row.likedBy),
  repostedBy: normalizeUuidArray(row.repostedBy),
});

const mapGroupCommentRow = (row) => ({
  id: row.id,
  groupPostId: row.groupPostId,
  authorId: row.authorId,
  text: row.text,
  likedBy: normalizeUuidArray(row.likedBy),
  createdAt: row.createdAt,
});

const mapDialogRow = (row) => ({
  id: row.id,
  kind: row.kind,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  unreadCount: row.unreadCount,
  peer: row.peerId
    ? {
        id: row.peerId,
        username: row.peerUsername,
        displayName: row.peerDisplayName,
        avatarUrl: row.peerAvatarUrl,
        bio: row.peerBio,
        status: row.peerStatus,
        coverImage: row.peerCoverImage,
        hiddenFromFriends: row.peerHiddenFromFriends,
        role: row.peerRole,
        banned: row.peerBanned,
        restricted: row.peerRestricted,
        isVerified: row.peerIsVerified,
        createdAt: row.peerCreatedAt,
        updatedAt: row.peerUpdatedAt,
      }
    : null,
  lastMessage: row.lastMessageId
    ? {
        id: row.lastMessageId,
        senderId: row.lastMessageSenderId,
        receiverId: row.lastMessageReceiverId,
        content: row.lastMessageContent,
        createdAt: row.lastMessageCreatedAt,
      }
    : null,
});

const wsAuthBySocket = new WeakMap();
const wss = new WebSocketServer({ noServer: true });

const wsSend = (socket, payload) => {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
};

const wsBroadcastLocalMessage = (message) => {
  const recipients = new Set([message.senderId, message.receiverId]);
  wss.clients.forEach((socket) => {
    const socketUserId = wsAuthBySocket.get(socket);
    if (!socketUserId || !recipients.has(socketUserId)) return;
    wsSend(socket, { type: 'message:new', message });
  });
};

const wsBroadcastMessage = async (message) => {
  if (redisPubSubReady) {
    try {
      await redis.publish(WS_MESSAGE_CHANNEL, JSON.stringify(message));
      return;
    } catch {
      // fallback to local delivery
    }
  }
  wsBroadcastLocalMessage(message);
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

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(
  '/api/admin/sql/import',
  express.text({
    type: ['application/sql', 'text/plain', 'application/octet-stream'],
    limit: '75mb',
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: GLOBAL_RATE_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AUTH_RATE_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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
        const { rows: countRows } = await client.query('SELECT COUNT(*)::INT AS total FROM users');
        const isFirstUser = (countRows[0]?.total || 0) === 0;
        const role = isFirstUser || adminEmails.has(email) ? 'admin' : 'user';

        const inserted = await client.query(
          `
            INSERT INTO users (
              username,
              email,
              password_hash,
              display_name,
              role,
              is_verified,
              email_verification_required
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, email
          `,
          [
            username,
            email,
            passwordHash,
            displayName || username,
            role,
            !verificationRequired,
            verificationRequired,
          ]
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
      await saveEmailCode({ userId: user.id, purpose: 'register', code, targetEmail: user.email });
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

    const verification = await consumeEmailCode({ userId, purpose: 'register', code });
    if (!verification.ok) {
      if (verification.reason === 'expired') throw new HttpError(400, 'Verification code expired.');
      throw new HttpError(400, 'Invalid verification code.');
    }

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

    const user = await loadUserById(userId);
    if (!user) throw new HttpError(404, 'User not found.');

    const token = signToken(userId);
    res.status(200).json({ ok: true, token, user });
  })
);

app.post(
  '/api/auth/resend-verification',
  authLimiter,
  asyncRoute(async (req, res) => {
    const userId = sanitize(req.body.userId);
    if (!isUUID(userId)) throw new HttpError(400, 'Valid userId is required.');

    const { rows } = await pool.query(
      `
        SELECT
          id,
          email,
          banned,
          is_verified AS "isVerified",
          email_verification_required AS "emailVerificationRequired"
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.banned) throw new HttpError(403, 'Account is banned.');
    if (user.isVerified || !user.emailVerificationRequired) {
      res.status(200).json({ ok: true, message: 'Email is already verified.' });
      return;
    }

    const code = sixDigitCode();
    await saveEmailCode({ userId: user.id, purpose: 'register', code, targetEmail: user.email });
    await sendCodeEmail(user.email, 'Verify your Aura Social account', code);
    res.status(200).json({ ok: true, message: 'Verification code sent.' });
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
          is_verified AS "isVerified",
          email_verification_required AS "emailVerificationRequired",
          banned
        FROM users
        WHERE username = $1 OR email = $1
        LIMIT 1
      `,
      [identity]
    );

    const user = rows[0];
    if (!user) throw new HttpError(401, 'Invalid credentials.');
    if (user.banned) throw new HttpError(403, 'Account is banned.');

    const passwordCheck = await verifyPassword(password, user.passwordHash);
    if (!passwordCheck.ok) throw new HttpError(401, 'Invalid credentials.');

    if (passwordCheck.legacyPlain) {
      const nextHash = await bcrypt.hash(password, 12);
      await pool.query(
        `
          UPDATE users
          SET password_hash = $1,
              is_verified = TRUE,
              email_verification_required = FALSE,
              updated_at = NOW()
          WHERE id = $2
        `,
        [nextHash, user.id]
      );
      user.isVerified = true;
      user.emailVerificationRequired = false;
    }

    const hasLegacyLocalEmail =
      typeof user.email === 'string' && user.email.toLowerCase().endsWith('@aura.local');
    if (!user.isVerified && hasLegacyLocalEmail) {
      await pool.query(
        `
          UPDATE users
          SET is_verified = TRUE,
              email_verification_required = FALSE,
              updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
      user.isVerified = true;
      user.emailVerificationRequired = false;
    }

    if (verificationRequired && !user.isVerified) {
      try {
        const code = sixDigitCode();
        await saveEmailCode({ userId: user.id, purpose: 'register', code, targetEmail: user.email });
        await sendCodeEmail(user.email, 'Verify your Aura Social account', code);
      } catch {
        // keep explicit verification response even if resend fails
      }
      res.status(403).json({
        ok: false,
        message: 'Email not verified.',
        requiresVerification: true,
        userId: user.id,
      });
      return;
    }

    const fullUser = await loadUserById(user.id);
    const token = signToken(user.id);
    res.status(200).json({ ok: true, token, user: fullUser });
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
  '/api/users/:id',
  asyncRoute(async (req, res) => {
    if (!/^[0-9a-fA-F-]{36}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { rows } = await pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.display_name AS "displayName",
          u.avatar_url AS "avatarUrl",
          u.bio,
          u.status,
          u.cover_image_url AS "coverImage",
          u.hidden_from_friends AS "hiddenFromFriends",
          u.role,
          u.banned,
          u.restricted,
          u.is_verified AS "isVerified",
          u.created_at AS "createdAt",
          u.updated_at AS "updatedAt",
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
            status,
            cover_image_url AS "coverImage",
            hidden_from_friends AS "hiddenFromFriends",
            role,
            banned,
            restricted,
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
          status,
          cover_image_url AS "coverImage",
          hidden_from_friends AS "hiddenFromFriends",
          role,
          banned,
          restricted,
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
    const status = req.body.status !== undefined ? String(req.body.status || '') : null;
    const coverImage = req.body.coverImage !== undefined ? sanitize(req.body.coverImage) : null;
    const hiddenFromFriends =
      req.body.hiddenFromFriends !== undefined ? Boolean(req.body.hiddenFromFriends) : null;

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
    if (status !== null) {
      updates.push(`status = $${index}`);
      values.push(status);
      index += 1;
    }
    if (coverImage !== null) {
      updates.push(`cover_image_url = $${index}`);
      values.push(coverImage || null);
      index += 1;
    }
    if (hiddenFromFriends !== null) {
      updates.push(`hidden_from_friends = $${index}`);
      values.push(hiddenFromFriends);
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
          status,
          cover_image_url AS "coverImage",
          hidden_from_friends AS "hiddenFromFriends",
          role,
          banned,
          restricted,
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
    await saveEmailCode({
      userId: actor.id,
      purpose: 'change_email',
      code,
      targetEmail: newEmail,
    });
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

    const verification = await consumeEmailCode({
      userId: actor.id,
      purpose: 'change_email',
      code,
    });
    if (!verification.ok || !verification.targetEmail) {
      if (verification.reason === 'expired') throw new HttpError(400, 'Code expired.');
      throw new HttpError(400, 'Invalid confirmation code.');
    }

    try {
      await pool.query(
        `
          UPDATE users
          SET email = $1,
              updated_at = NOW()
          WHERE id = $2
        `,
        [verification.targetEmail, actor.id]
      );
    } catch (error) {
      if (error && typeof error === 'object' && error.code === '23505') {
        throw new HttpError(409, 'Email already in use.');
      }
      throw error;
    }

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
	          COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy",
	          COALESCE(reposts.user_ids, ARRAY[]::UUID[]) AS "repostedBy",
	          u.id AS "authorId",
	          u.username AS "authorUsername",
	          u.display_name AS "authorDisplayName",
	          u.avatar_url AS "authorAvatarUrl",
	          u.bio AS "authorBio",
	          u.status AS "authorStatus",
	          u.cover_image_url AS "authorCoverImage",
	          u.hidden_from_friends AS "authorHiddenFromFriends",
	          u.role AS "authorRole",
	          u.banned AS "authorBanned",
	          u.restricted AS "authorRestricted",
	          u.is_verified AS "authorIsVerified",
	          u.created_at AS "authorCreatedAt",
	          u.updated_at AS "authorUpdatedAt"
	        FROM posts p
	        JOIN users u ON u.id = p.user_id
	        LEFT JOIN LATERAL (
	          SELECT array_agg(user_id)::UUID[] AS user_ids
	          FROM post_likes
	          WHERE post_id = p.id
	        ) likes ON TRUE
	        LEFT JOIN LATERAL (
	          SELECT array_agg(user_id)::UUID[] AS user_ids
	          FROM post_reposts
	          WHERE post_id = p.id
	        ) reposts ON TRUE
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
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
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
      likedBy: [],
      repostedBy: [],
      author: {
        id: actor.id,
        username: actor.username,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        bio: actor.bio,
        status: actor.status,
        coverImage: actor.coverImage,
        hiddenFromFriends: actor.hiddenFromFriends,
        role: actor.role,
        banned: actor.banned,
        restricted: actor.restricted,
        isVerified: actor.isVerified,
        createdAt: actor.createdAt,
        updatedAt: actor.updatedAt,
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
	          COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy",
	          COALESCE(reposts.user_ids, ARRAY[]::UUID[]) AS "repostedBy",
	          u.id AS "authorId",
	          u.username AS "authorUsername",
	          u.display_name AS "authorDisplayName",
	          u.avatar_url AS "authorAvatarUrl",
	          u.bio AS "authorBio",
	          u.status AS "authorStatus",
	          u.cover_image_url AS "authorCoverImage",
	          u.hidden_from_friends AS "authorHiddenFromFriends",
	          u.role AS "authorRole",
	          u.banned AS "authorBanned",
	          u.restricted AS "authorRestricted",
	          u.is_verified AS "authorIsVerified",
	          u.created_at AS "authorCreatedAt",
	          u.updated_at AS "authorUpdatedAt"
	        FROM posts p
	        JOIN users u ON u.id = p.user_id
	        LEFT JOIN LATERAL (
	          SELECT array_agg(user_id)::UUID[] AS user_ids
	          FROM post_likes
	          WHERE post_id = p.id
	        ) likes ON TRUE
	        LEFT JOIN LATERAL (
	          SELECT array_agg(user_id)::UUID[] AS user_ids
	          FROM post_reposts
	          WHERE post_id = p.id
	        ) reposts ON TRUE
	        ORDER BY p.created_at DESC
	        LIMIT $1 OFFSET $2
	      `,
      [limit, offset]
    );

    const postIds = rows.map((row) => row.id).filter(Boolean);

    const commentRows = postIds.length
      ? await pool.query(
          `
            SELECT
              c.id,
              c.post_id AS "postId",
              c.author_id AS "authorId",
              c.content AS text,
              c.created_at AS "createdAt",
              COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy"
            FROM (
              SELECT
                pc.id,
                pc.post_id,
                pc.author_id,
                pc.content,
                pc.created_at,
                ROW_NUMBER() OVER (PARTITION BY pc.post_id ORDER BY pc.created_at DESC) AS rn
              FROM post_comments pc
              WHERE pc.post_id = ANY($1::UUID[])
            ) c
            LEFT JOIN LATERAL (
              SELECT array_agg(user_id)::UUID[] AS user_ids
              FROM post_comment_likes
              WHERE comment_id = c.id
            ) likes ON TRUE
            WHERE c.rn <= 10
            ORDER BY c.created_at DESC
          `,
          [postIds]
        )
      : { rows: [] };

    const commentUserIds = [
      ...new Set((commentRows.rows || []).map((row) => row.authorId).filter(Boolean)),
    ];
    const users = commentUserIds.length
      ? (
          await pool.query(
            `
              SELECT
                id,
                username,
                display_name AS "displayName",
                avatar_url AS "avatarUrl",
                bio,
                status,
                cover_image_url AS "coverImage",
                hidden_from_friends AS "hiddenFromFriends",
                role,
                banned,
                restricted,
                is_verified AS "isVerified",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
              FROM users
              WHERE id = ANY($1::UUID[])
            `,
            [commentUserIds]
          )
        ).rows
      : [];

    const payload = {
      ok: true,
      page,
      limit,
      offset,
      items: rows.map(mapPostRow),
      comments: (commentRows.rows || []).map(mapPostCommentRow),
      users,
    };

    await setCachedFeed(authUserId, page, limit, payload);
    res.status(200).json(payload);
  })
);

app.post(
  '/api/posts/:id/like',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const exists = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Post not found.');

    const likedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2 LIMIT 1',
        [postId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [
          postId,
          actor.id,
        ]);
      } else {
        await client.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [
          postId,
          actor.id,
        ]);
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"likedBy\" FROM post_likes WHERE post_id = $1',
        [postId]
      );
      return normalizeUuidArray(after.rows[0]?.likedBy);
    });

    await invalidateFeedCacheForUsers([actor.id]);
    res.status(200).json({ ok: true, likedBy });
  })
);

app.post(
  '/api/posts/:id/repost',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const exists = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Post not found.');

    const repostedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM post_reposts WHERE post_id = $1 AND user_id = $2 LIMIT 1',
        [postId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query('DELETE FROM post_reposts WHERE post_id = $1 AND user_id = $2', [
          postId,
          actor.id,
        ]);
      } else {
        await client.query('INSERT INTO post_reposts (post_id, user_id) VALUES ($1, $2)', [
          postId,
          actor.id,
        ]);
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"repostedBy\" FROM post_reposts WHERE post_id = $1',
        [postId]
      );
      return normalizeUuidArray(after.rows[0]?.repostedBy);
    });

    await invalidateFeedCacheForUsers([actor.id]);
    res.status(200).json({ ok: true, repostedBy });
  })
);

app.get(
  '/api/posts/:id/comments',
  asyncRoute(async (req, res) => {
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');
    const { limit, offset, page } = parsePagination(req);

    const exists = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Post not found.');

    const { rows } = await pool.query(
      `
        SELECT
          c.id,
          c.post_id AS "postId",
          c.author_id AS "authorId",
          c.content AS text,
          c.created_at AS "createdAt",
          COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy"
        FROM post_comments c
        LEFT JOIN LATERAL (
          SELECT array_agg(user_id)::UUID[] AS user_ids
          FROM post_comment_likes
          WHERE comment_id = c.id
        ) likes ON TRUE
        WHERE c.post_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [postId, limit, offset]
    );

    const userIds = [...new Set(rows.map((row) => row.authorId).filter(Boolean))];
    const users = userIds.length
      ? (
          await pool.query(
            `
              SELECT
                id,
                username,
                display_name AS "displayName",
                avatar_url AS "avatarUrl",
                bio,
                status,
                cover_image_url AS "coverImage",
                hidden_from_friends AS "hiddenFromFriends",
                role,
                banned,
                restricted,
                is_verified AS "isVerified",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
              FROM users
              WHERE id = ANY($1::UUID[])
            `,
            [userIds]
          )
        ).rows
      : [];

    res.status(200).json({
      ok: true,
      page,
      limit,
      offset,
      items: rows.map(mapPostCommentRow),
      users,
    });
  })
);

app.post(
  '/api/posts/:id/comments',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');
    const text = String(req.body.text || req.body.content || '').trim();
    if (!text) throw new HttpError(400, 'Comment is required.');

    const exists = await pool.query('SELECT id FROM posts WHERE id = $1 LIMIT 1', [postId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Post not found.');

    const inserted = await pool.query(
      `
        INSERT INTO post_comments (post_id, author_id, content)
        VALUES ($1, $2, $3)
        RETURNING
          id,
          post_id AS "postId",
          author_id AS "authorId",
          content AS text,
          created_at AS "createdAt"
      `,
      [postId, actor.id, text]
    );

    await invalidateFeedCacheForUsers([actor.id]);
    res.status(201).json({
      ok: true,
      comment: mapPostCommentRow({ ...inserted.rows[0], likedBy: [] }),
      users: [
        {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
          bio: actor.bio,
          status: actor.status,
          coverImage: actor.coverImage,
          hiddenFromFriends: actor.hiddenFromFriends,
          role: actor.role,
          banned: actor.banned,
          restricted: actor.restricted,
          isVerified: actor.isVerified,
          createdAt: actor.createdAt,
          updatedAt: actor.updatedAt,
        },
      ],
    });
  })
);

app.patch(
  '/api/posts/comments/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');
    const text = String(req.body.text || req.body.content || '').trim();
    if (!text) throw new HttpError(400, 'Comment is required.');

    const { rows } = await pool.query(
      'SELECT id, author_id AS \"authorId\" FROM post_comments WHERE id = $1 LIMIT 1',
      [commentId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Comment not found.');
    if (actor.role !== 'admin' && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    const updated = await pool.query(
      `
        UPDATE post_comments
        SET content = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          post_id AS "postId",
          author_id AS "authorId",
          content AS text,
          created_at AS "createdAt"
      `,
      [text, commentId]
    );

    const reactions = await pool.query(
      'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"likedBy\" FROM post_comment_likes WHERE comment_id = $1',
      [commentId]
    );

    await invalidateFeedCacheForUsers([actor.id]);
    res.status(200).json({
      ok: true,
      comment: mapPostCommentRow({ ...updated.rows[0], likedBy: reactions.rows[0]?.likedBy || [] }),
    });
  })
);

app.delete(
  '/api/posts/comments/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');

    const { rows } = await pool.query(
      'SELECT id, author_id AS \"authorId\" FROM post_comments WHERE id = $1 LIMIT 1',
      [commentId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Comment not found.');
    if (actor.role !== 'admin' && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    await pool.query('DELETE FROM post_comments WHERE id = $1', [commentId]);
    await invalidateFeedCacheForUsers([actor.id]);
    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/posts/comments/:id/like',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');

    const exists = await pool.query('SELECT id FROM post_comments WHERE id = $1 LIMIT 1', [commentId]);
    if (!exists.rows[0]) throw new HttpError(404, 'Comment not found.');

    const likedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM post_comment_likes WHERE comment_id = $1 AND user_id = $2 LIMIT 1',
        [commentId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query('DELETE FROM post_comment_likes WHERE comment_id = $1 AND user_id = $2', [
          commentId,
          actor.id,
        ]);
      } else {
        await client.query('INSERT INTO post_comment_likes (comment_id, user_id) VALUES ($1, $2)', [
          commentId,
          actor.id,
        ]);
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"likedBy\" FROM post_comment_likes WHERE comment_id = $1',
        [commentId]
      );
      return normalizeUuidArray(after.rows[0]?.likedBy);
    });

    await invalidateFeedCacheForUsers([actor.id]);
    res.status(200).json({ ok: true, likedBy });
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

const groupAvatarUrl = (name) => {
  const label = encodeURIComponent(String(name || 'Group').slice(0, 40));
  return `https://ui-avatars.com/api/?name=${label}&background=0f172a&color=ffffff&size=256`;
};

const loadGroupById = async (groupId) => {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        name,
        description,
        admin_id AS "adminId",
        allow_member_posts AS "allowMemberPosts",
        avatar_url AS avatar,
        cover_image_url AS "coverImage",
        verified,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM groups
      WHERE id = $1
      LIMIT 1
    `,
    [groupId]
  );
  return rows[0] || null;
};

const loadGroupMember = async (groupId, userId) => {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        group_id AS "groupId",
        user_id AS "userId",
        role,
        created_at AS "createdAt"
      FROM group_members
      WHERE group_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );
  return rows[0] || null;
};

const isGroupAdmin = (actor, group, membership) =>
  Boolean(
    actor &&
      group &&
      (actor.role === 'admin' ||
        group.adminId === actor.id ||
        String(membership?.role || '') === 'admin')
  );

const loadUsersByIds = async (userIds) => {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return [];
  const { rows } = await pool.query(
    `
      SELECT
        id,
        username,
        display_name AS "displayName",
        avatar_url AS "avatarUrl",
        bio,
        status,
        cover_image_url AS "coverImage",
        hidden_from_friends AS "hiddenFromFriends",
        role,
        banned,
        restricted,
        is_verified AS "isVerified",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM users
      WHERE id = ANY($1::UUID[])
    `,
    [unique]
  );
  return rows;
};

app.get(
  '/api/groups',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { limit, offset, page } = parsePagination(req);
    const query = sanitize(req.query.q || '').toLowerCase();

    const { rows: groupRows } = query
      ? await pool.query(
          `
            SELECT
              id,
              name,
              description,
              admin_id AS "adminId",
              allow_member_posts AS "allowMemberPosts",
              avatar_url AS avatar,
              cover_image_url AS "coverImage",
              verified,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM groups
            WHERE LOWER(name) LIKE $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
          `,
          [`%${query}%`, limit, offset]
        )
      : await pool.query(
          `
            SELECT
              id,
              name,
              description,
              admin_id AS "adminId",
              allow_member_posts AS "allowMemberPosts",
              avatar_url AS avatar,
              cover_image_url AS "coverImage",
              verified,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
            FROM groups
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
          `,
          [limit, offset]
        );

    const groupIds = groupRows.map((row) => row.id).filter(Boolean);
    const members = groupIds.length
      ? await pool.query(
          `
            SELECT
              id,
              group_id AS "groupId",
              user_id AS "userId",
              role,
              created_at AS "createdAt"
            FROM group_members
            WHERE group_id = ANY($1::UUID[])
          `,
          [groupIds]
        )
      : { rows: [] };

    const userIds = [
      ...groupRows.map((row) => row.adminId),
      ...members.rows.map((row) => row.userId),
    ];
    const users = await loadUsersByIds(userIds);

    res.status(200).json({
      ok: true,
      page,
      limit,
      offset,
      groups: groupRows.map(mapGroupRow),
      members: members.rows.map(mapGroupMemberRow),
      users,
    });
  })
);

app.post(
  '/api/groups',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const name = sanitize(req.body.name);
    const description = String(req.body.description || '');
    const allowMemberPosts = req.body.allowMemberPosts !== undefined ? Boolean(req.body.allowMemberPosts) : true;

    if (!name || name.length < 3 || name.length > 64) {
      throw new HttpError(400, 'Group name must be 3-64 chars.');
    }

    const result = await withTransaction(async (client) => {
      try {
        const insertedGroup = await client.query(
          `
            INSERT INTO groups (
              name,
              description,
              admin_id,
              allow_member_posts,
              avatar_url,
              cover_image_url,
              verified
            )
            VALUES ($1, $2, $3, $4, $5, '', FALSE)
            RETURNING
              id,
              name,
              description,
              admin_id AS "adminId",
              allow_member_posts AS "allowMemberPosts",
              avatar_url AS avatar,
              cover_image_url AS "coverImage",
              verified,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
          `,
          [name, description, actor.id, allowMemberPosts, groupAvatarUrl(name)]
        );

        const group = insertedGroup.rows[0];

        const insertedMember = await client.query(
          `
            INSERT INTO group_members (group_id, user_id, role)
            VALUES ($1, $2, 'admin')
            RETURNING
              id,
              group_id AS "groupId",
              user_id AS "userId",
              role,
              created_at AS "createdAt"
          `,
          [group.id, actor.id]
        );

        return { group, member: insertedMember.rows[0] };
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          throw new HttpError(409, 'Group name already exists.');
        }
        throw error;
      }
    });

    res.status(201).json({
      ok: true,
      group: mapGroupRow(result.group),
      member: mapGroupMemberRow(result.member),
      users: await loadUsersByIds([result.group.adminId]),
    });
  })
);

app.get(
  '/api/groups/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const groupId = sanitize(req.params.id);
    if (!isUUID(groupId)) throw new HttpError(400, 'Invalid group id.');

    const group = await loadGroupById(groupId);
    if (!group) throw new HttpError(404, 'Group not found.');

    const membership = await loadGroupMember(groupId, actor.id);

    const { limit, offset, page } = parsePagination(req);
    const { rows: memberRows } = await pool.query(
      `
        SELECT
          id,
          group_id AS "groupId",
          user_id AS "userId",
          role,
          created_at AS "createdAt"
        FROM group_members
        WHERE group_id = $1
        ORDER BY created_at ASC
      `,
      [groupId]
    );

    const { rows: postRows } = await pool.query(
      `
        SELECT
          gp.id,
          gp.group_id AS "groupId",
          gp.author_id AS "authorId",
          gp.content AS text,
          gp.media_type AS "mediaType",
          gp.media_url AS "mediaUrl",
          gp.repost_of_post_id AS "repostOfPostId",
          gp.created_at AS "createdAt",
          COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy",
          COALESCE(reposts.user_ids, ARRAY[]::UUID[]) AS "repostedBy"
        FROM group_posts gp
        LEFT JOIN LATERAL (
          SELECT array_agg(user_id)::UUID[] AS user_ids
          FROM group_post_likes
          WHERE group_post_id = gp.id
        ) likes ON TRUE
        LEFT JOIN LATERAL (
          SELECT array_agg(user_id)::UUID[] AS user_ids
          FROM group_post_reposts
          WHERE group_post_id = gp.id
        ) reposts ON TRUE
        WHERE gp.group_id = $1
        ORDER BY gp.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [groupId, limit, offset]
    );

    const postIds = postRows.map((row) => row.id).filter(Boolean);
    const commentRows = postIds.length
      ? await pool.query(
          `
            SELECT
              c.id,
              c.group_post_id AS "groupPostId",
              c.author_id AS "authorId",
              c.content AS text,
              c.created_at AS "createdAt",
              COALESCE(likes.user_ids, ARRAY[]::UUID[]) AS "likedBy"
            FROM group_post_comments c
            LEFT JOIN LATERAL (
              SELECT array_agg(user_id)::UUID[] AS user_ids
              FROM group_post_comment_likes
              WHERE group_post_comment_id = c.id
            ) likes ON TRUE
            WHERE c.group_post_id = ANY($1::UUID[])
            ORDER BY c.created_at ASC
          `,
          [postIds]
        )
      : { rows: [] };

    const userIds = [
      group.adminId,
      ...memberRows.map((row) => row.userId),
      ...postRows.map((row) => row.authorId),
      ...commentRows.rows.map((row) => row.authorId),
    ];

    res.status(200).json({
      ok: true,
      page,
      limit,
      offset,
      group: mapGroupRow(group),
      membership: membership ? mapGroupMemberRow(membership) : null,
      members: memberRows.map(mapGroupMemberRow),
      posts: postRows.map(mapGroupPostRow),
      comments: commentRows.rows.map(mapGroupCommentRow),
      users: await loadUsersByIds(userIds),
    });
  })
);

app.patch(
  '/api/groups/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const groupId = sanitize(req.params.id);
    if (!isUUID(groupId)) throw new HttpError(400, 'Invalid group id.');

    const group = await loadGroupById(groupId);
    if (!group) throw new HttpError(404, 'Group not found.');
    const membership = await loadGroupMember(groupId, actor.id);
    if (!isGroupAdmin(actor, group, membership)) throw new HttpError(403, 'Forbidden.');

    const name = req.body.name !== undefined ? sanitize(req.body.name) : null;
    const description = req.body.description !== undefined ? String(req.body.description || '') : null;
    const avatar = req.body.avatar !== undefined ? sanitize(req.body.avatar) : null;
    const coverImage = req.body.coverImage !== undefined ? sanitize(req.body.coverImage) : null;
    const allowMemberPosts = req.body.allowMemberPosts !== undefined ? Boolean(req.body.allowMemberPosts) : null;
    const verified = req.body.verified !== undefined ? Boolean(req.body.verified) : null;

    const updates = [];
    const values = [];
    let index = 1;

    if (name !== null) {
      if (!name || name.length < 3 || name.length > 64) throw new HttpError(400, 'Group name must be 3-64 chars.');
      updates.push(`name = $${index}`);
      values.push(name);
      index += 1;
    }
    if (description !== null) {
      updates.push(`description = $${index}`);
      values.push(description);
      index += 1;
    }
    if (avatar !== null) {
      updates.push(`avatar_url = $${index}`);
      values.push(avatar || groupAvatarUrl(name || group.name));
      index += 1;
    }
    if (coverImage !== null) {
      updates.push(`cover_image_url = $${index}`);
      values.push(coverImage || '');
      index += 1;
    }
    if (allowMemberPosts !== null) {
      updates.push(`allow_member_posts = $${index}`);
      values.push(allowMemberPosts);
      index += 1;
    }
    if (verified !== null) {
      if (actor.role !== 'admin') throw new HttpError(403, 'Admin access required to set verified.');
      updates.push(`verified = $${index}`);
      values.push(verified);
      index += 1;
    }

    if (!updates.length) throw new HttpError(400, 'Nothing to update.');

    values.push(groupId);

    let updated;
    try {
      const { rows } = await pool.query(
        `
          UPDATE groups
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${index}
          RETURNING
            id,
            name,
            description,
            admin_id AS "adminId",
            allow_member_posts AS "allowMemberPosts",
            avatar_url AS avatar,
            cover_image_url AS "coverImage",
            verified,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        values
      );
      updated = rows[0] || null;
    } catch (error) {
      if (error && typeof error === 'object' && error.code === '23505') {
        throw new HttpError(409, 'Group name already exists.');
      }
      throw error;
    }

    if (!updated) throw new HttpError(404, 'Group not found.');
    res.status(200).json({ ok: true, group: mapGroupRow(updated) });
  })
);

app.post(
  '/api/groups/:id/subscribe',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const groupId = sanitize(req.params.id);
    if (!isUUID(groupId)) throw new HttpError(400, 'Invalid group id.');
    const group = await loadGroupById(groupId);
    if (!group) throw new HttpError(404, 'Group not found.');

    const role = group.adminId === actor.id ? 'admin' : 'member';
    const { rows } = await pool.query(
      `
        INSERT INTO group_members (group_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (group_id, user_id)
        DO UPDATE SET role = EXCLUDED.role
        RETURNING
          id,
          group_id AS "groupId",
          user_id AS "userId",
          role,
          created_at AS "createdAt"
      `,
      [groupId, actor.id, role]
    );

    res.status(200).json({ ok: true, member: mapGroupMemberRow(rows[0]) });
  })
);

app.delete(
  '/api/groups/:id/subscribe',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const groupId = sanitize(req.params.id);
    if (!isUUID(groupId)) throw new HttpError(400, 'Invalid group id.');
    const group = await loadGroupById(groupId);
    if (!group) throw new HttpError(404, 'Group not found.');
    if (group.adminId === actor.id) throw new HttpError(400, 'Group owner cannot unsubscribe.');

    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, actor.id]);
    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/groups/:id/posts',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const groupId = sanitize(req.params.id);
    if (!isUUID(groupId)) throw new HttpError(400, 'Invalid group id.');
    const content = String(req.body.content || req.body.text || '').trim();
    const mediaTypeRaw = req.body.mediaType !== undefined ? sanitize(req.body.mediaType).toLowerCase() : '';
    const mediaType = mediaTypeRaw === 'image' || mediaTypeRaw === 'video' ? mediaTypeRaw : null;
    const mediaUrl = req.body.mediaUrl !== undefined ? sanitize(req.body.mediaUrl) : null;
    const repostOfPostId = req.body.repostOfPostId !== undefined ? sanitize(req.body.repostOfPostId) : null;

    if (!content && !mediaUrl) throw new HttpError(400, 'Post content is required.');

    const group = await loadGroupById(groupId);
    if (!group) throw new HttpError(404, 'Group not found.');

    const membership = await loadGroupMember(groupId, actor.id);
    const admin = isGroupAdmin(actor, group, membership);
    const canPost =
      admin ||
      (membership && (group.allowMemberPosts || String(membership.role || '') === 'admin'));
    if (!canPost) throw new HttpError(403, 'You cannot publish in this group.');

    const inserted = await pool.query(
      `
        INSERT INTO group_posts (group_id, author_id, content, media_type, media_url, repost_of_post_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          group_id AS "groupId",
          author_id AS "authorId",
          content AS text,
          media_type AS "mediaType",
          media_url AS "mediaUrl",
          repost_of_post_id AS "repostOfPostId",
          created_at AS "createdAt"
      `,
      [groupId, actor.id, content, mediaType, mediaUrl, repostOfPostId || null]
    );

    await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [groupId]);

    const post = mapGroupPostRow({
      ...inserted.rows[0],
      likedBy: [],
      repostedBy: [],
    });
    res.status(201).json({ ok: true, post });
  })
);

app.patch(
  '/api/groups/posts/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');
    const content = String(req.body.content || req.body.text || '').trim();
    if (!content) throw new HttpError(400, 'Post content is required.');

    const { rows } = await pool.query(
      `
        SELECT
          gp.id,
          gp.group_id AS "groupId",
          gp.author_id AS "authorId",
          g.admin_id AS "groupAdminId"
        FROM group_posts gp
        JOIN groups g ON g.id = gp.group_id
        WHERE gp.id = $1
        LIMIT 1
      `,
      [postId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Post not found.');
    const membership = await loadGroupMember(row.groupId, actor.id);
    const admin = actor.role === 'admin' || row.groupAdminId === actor.id || String(membership?.role || '') === 'admin';
    if (!admin && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    const updated = await pool.query(
      `
        UPDATE group_posts
        SET content = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          group_id AS "groupId",
          author_id AS "authorId",
          content AS text,
          media_type AS "mediaType",
          media_url AS "mediaUrl",
          repost_of_post_id AS "repostOfPostId",
          created_at AS "createdAt"
      `,
      [content, postId]
    );

    const reactions = await pool.query(
      `
        SELECT
          ARRAY(SELECT user_id FROM group_post_likes WHERE group_post_id = $1) AS "likedBy",
          ARRAY(SELECT user_id FROM group_post_reposts WHERE group_post_id = $1) AS "repostedBy"
      `,
      [postId]
    );

    const post = mapGroupPostRow({
      ...updated.rows[0],
      likedBy: reactions.rows[0]?.likedBy || [],
      repostedBy: reactions.rows[0]?.repostedBy || [],
    });
    res.status(200).json({ ok: true, post });
  })
);

app.delete(
  '/api/groups/posts/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const { rows } = await pool.query(
      `
        SELECT
          gp.id,
          gp.group_id AS "groupId",
          gp.author_id AS "authorId",
          g.admin_id AS "groupAdminId"
        FROM group_posts gp
        JOIN groups g ON g.id = gp.group_id
        WHERE gp.id = $1
        LIMIT 1
      `,
      [postId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Post not found.');
    const membership = await loadGroupMember(row.groupId, actor.id);
    const admin = actor.role === 'admin' || row.groupAdminId === actor.id || String(membership?.role || '') === 'admin';
    if (!admin && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    await pool.query('DELETE FROM group_posts WHERE id = $1', [postId]);
    await pool.query('UPDATE groups SET updated_at = NOW() WHERE id = $1', [row.groupId]);
    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/groups/posts/:id/comments',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');
    const text = String(req.body.text || req.body.content || '').trim();
    if (!text) throw new HttpError(400, 'Comment is required.');

    const { rows } = await pool.query(
      'SELECT group_id AS \"groupId\" FROM group_posts WHERE id = $1 LIMIT 1',
      [postId]
    );
    const groupId = rows[0]?.groupId || null;
    if (!groupId) throw new HttpError(404, 'Post not found.');
    const membership = await loadGroupMember(groupId, actor.id);
    if (!membership && actor.role !== 'admin') throw new HttpError(403, 'Join the group to comment.');

    const inserted = await pool.query(
      `
        INSERT INTO group_post_comments (group_post_id, author_id, content)
        VALUES ($1, $2, $3)
        RETURNING
          id,
          group_post_id AS "groupPostId",
          author_id AS "authorId",
          content AS text,
          created_at AS "createdAt"
      `,
      [postId, actor.id, text]
    );

    res.status(201).json({ ok: true, comment: mapGroupCommentRow({ ...inserted.rows[0], likedBy: [] }) });
  })
);

app.patch(
  '/api/groups/comments/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');
    const text = String(req.body.text || req.body.content || '').trim();
    if (!text) throw new HttpError(400, 'Comment is required.');

    const { rows } = await pool.query(
      `
        SELECT
          c.id,
          c.group_post_id AS "groupPostId",
          c.author_id AS "authorId",
          p.group_id AS "groupId",
          g.admin_id AS "groupAdminId"
        FROM group_post_comments c
        JOIN group_posts p ON p.id = c.group_post_id
        JOIN groups g ON g.id = p.group_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [commentId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Comment not found.');
    const membership = await loadGroupMember(row.groupId, actor.id);
    const admin = actor.role === 'admin' || row.groupAdminId === actor.id || String(membership?.role || '') === 'admin';
    if (!admin && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    const updated = await pool.query(
      `
        UPDATE group_post_comments
        SET content = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          group_post_id AS "groupPostId",
          author_id AS "authorId",
          content AS text,
          created_at AS "createdAt"
      `,
      [text, commentId]
    );
    const reactions = await pool.query(
      `
        SELECT ARRAY(SELECT user_id FROM group_post_comment_likes WHERE comment_id = $1) AS "likedBy"
      `,
      [commentId]
    );
    res.status(200).json({
      ok: true,
      comment: mapGroupCommentRow({ ...updated.rows[0], likedBy: reactions.rows[0]?.likedBy || [] }),
    });
  })
);

app.delete(
  '/api/groups/comments/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');

    const { rows } = await pool.query(
      `
        SELECT
          c.id,
          c.author_id AS "authorId",
          p.group_id AS "groupId",
          g.admin_id AS "groupAdminId"
        FROM group_post_comments c
        JOIN group_posts p ON p.id = c.group_post_id
        JOIN groups g ON g.id = p.group_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [commentId]
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Comment not found.');
    const membership = await loadGroupMember(row.groupId, actor.id);
    const admin = actor.role === 'admin' || row.groupAdminId === actor.id || String(membership?.role || '') === 'admin';
    if (!admin && row.authorId !== actor.id) throw new HttpError(403, 'Forbidden.');

    await pool.query('DELETE FROM group_post_comments WHERE id = $1', [commentId]);
    res.status(200).json({ ok: true });
  })
);

app.post(
  '/api/groups/posts/:id/like',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const { rows } = await pool.query(
      'SELECT group_id AS \"groupId\" FROM group_posts WHERE id = $1 LIMIT 1',
      [postId]
    );
    const groupId = rows[0]?.groupId || null;
    if (!groupId) throw new HttpError(404, 'Post not found.');
    const membership = await loadGroupMember(groupId, actor.id);
    if (!membership && actor.role !== 'admin') throw new HttpError(403, 'Join the group to like posts.');

    const likedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM group_post_likes WHERE group_post_id = $1 AND user_id = $2 LIMIT 1',
        [postId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query('DELETE FROM group_post_likes WHERE group_post_id = $1 AND user_id = $2', [
          postId,
          actor.id,
        ]);
      } else {
        await client.query('INSERT INTO group_post_likes (group_post_id, user_id) VALUES ($1, $2)', [
          postId,
          actor.id,
        ]);
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"likedBy\" FROM group_post_likes WHERE group_post_id = $1',
        [postId]
      );
      return normalizeUuidArray(after.rows[0]?.likedBy);
    });

    res.status(200).json({ ok: true, likedBy });
  })
);

app.post(
  '/api/groups/posts/:id/repost',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const { rows } = await pool.query(
      'SELECT group_id AS \"groupId\" FROM group_posts WHERE id = $1 LIMIT 1',
      [postId]
    );
    const groupId = rows[0]?.groupId || null;
    if (!groupId) throw new HttpError(404, 'Post not found.');
    const membership = await loadGroupMember(groupId, actor.id);
    if (!membership && actor.role !== 'admin') throw new HttpError(403, 'Join the group to repost.');

    const repostedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM group_post_reposts WHERE group_post_id = $1 AND user_id = $2 LIMIT 1',
        [postId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query('DELETE FROM group_post_reposts WHERE group_post_id = $1 AND user_id = $2', [
          postId,
          actor.id,
        ]);
      } else {
        await client.query('INSERT INTO group_post_reposts (group_post_id, user_id) VALUES ($1, $2)', [
          postId,
          actor.id,
        ]);
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"repostedBy\" FROM group_post_reposts WHERE group_post_id = $1',
        [postId]
      );
      return normalizeUuidArray(after.rows[0]?.repostedBy);
    });

    res.status(200).json({ ok: true, repostedBy });
  })
);

app.post(
  '/api/groups/comments/:id/like',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const commentId = sanitize(req.params.id);
    if (!isUUID(commentId)) throw new HttpError(400, 'Invalid comment id.');

    const { rows } = await pool.query(
      `
        SELECT p.group_id AS "groupId"
        FROM group_post_comments c
        JOIN group_posts p ON p.id = c.group_post_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [commentId]
    );
    const groupId = rows[0]?.groupId || null;
    if (!groupId) throw new HttpError(404, 'Comment not found.');
    const membership = await loadGroupMember(groupId, actor.id);
    if (!membership && actor.role !== 'admin') throw new HttpError(403, 'Join the group to like comments.');

    const likedBy = await withTransaction(async (client) => {
      const existing = await client.query(
        'SELECT 1 FROM group_post_comment_likes WHERE comment_id = $1 AND user_id = $2 LIMIT 1',
        [commentId, actor.id]
      );
      if (existing.rows[0]) {
        await client.query(
          'DELETE FROM group_post_comment_likes WHERE comment_id = $1 AND user_id = $2',
          [commentId, actor.id]
        );
      } else {
        await client.query(
          'INSERT INTO group_post_comment_likes (comment_id, user_id) VALUES ($1, $2)',
          [commentId, actor.id]
        );
      }

      const after = await client.query(
        'SELECT COALESCE(array_agg(user_id)::UUID[], ARRAY[]::UUID[]) AS \"likedBy\" FROM group_post_comment_likes WHERE comment_id = $1',
        [commentId]
      );
      return normalizeUuidArray(after.rows[0]?.likedBy);
    });

    res.status(200).json({ ok: true, likedBy });
  })
);

app.post(
  '/api/messages',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    if (actor.restricted) throw new HttpError(403, 'Account is restricted.');
    const receiverId = sanitize(req.body.receiverId);
    const content = String(req.body.content || req.body.text || '').trim();

    if (!receiverId) throw new HttpError(400, 'receiverId is required.');
    if (!isUUID(receiverId)) throw new HttpError(400, 'receiverId must be a UUID.');
    if (!content) throw new HttpError(400, 'content is required.');
    if (receiverId === actor.id) throw new HttpError(400, 'Cannot send message to yourself.');

    const message = await withTransaction(async (client) => {
      const receiver = await client.query('SELECT id, banned FROM users WHERE id = $1 LIMIT 1', [receiverId]);
      if (!receiver.rows[0]) throw new HttpError(404, 'Receiver not found.');
      if (receiver.rows[0].banned) throw new HttpError(403, 'Receiver account is unavailable.');

      const dialogId = await ensureDirectDialog(client, actor.id, receiverId);

      const inserted = await client.query(
        `
          INSERT INTO messages (dialog_id, sender_id, receiver_id, content)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            dialog_id AS "dialogId",
            sender_id AS "senderId",
            receiver_id AS "receiverId",
            content,
            read_at AS "readAt",
            edited_at AS "editedAt",
            created_at AS "createdAt"
        `,
        [dialogId, actor.id, receiverId, content]
      );

      return mapMessageRow(inserted.rows[0]);
    });

    await invalidateChatsCacheForUsers([actor.id, receiverId]);
    await wsBroadcastMessage(message);
    res.status(201).json({ ok: true, message });
  })
);

app.get(
  '/api/messages/:userId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const otherUserId = req.params.userId;
    if (!isUUID(otherUserId)) throw new HttpError(400, 'Invalid user id.');
    const { limit, offset, page } = parsePagination(req);

    const [userA, userB] = sortUuidPair(actor.id, otherUserId);
    const { rows: dialogRows } = await pool.query(
      `
        SELECT id
        FROM dialogs
        WHERE kind = 'direct' AND direct_user_a = $1 AND direct_user_b = $2
        LIMIT 1
      `,
      [userA, userB]
    );

    const dialogId = dialogRows[0]?.id || null;
    if (!dialogId) {
      res.status(200).json({ ok: true, page, limit, offset, dialogId: null, items: [] });
      return;
    }

    const { rows } = await pool.query(
      `
        SELECT
          id,
          dialog_id AS "dialogId",
          sender_id AS "senderId",
          receiver_id AS "receiverId",
          content,
          read_at AS "readAt",
          edited_at AS "editedAt",
          created_at AS "createdAt"
        FROM messages
        WHERE dialog_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [dialogId, limit, offset]
    );

    await pool.query(
      `
        UPDATE messages
        SET read_at = NOW(),
            updated_at = NOW()
        WHERE dialog_id = $1
          AND receiver_id = $2
          AND read_at IS NULL
      `,
      [dialogId, actor.id]
    );
    await pool.query(
      `
        UPDATE dialog_members
        SET last_read_at = NOW()
        WHERE dialog_id = $1
          AND user_id = $2
      `,
      [dialogId, actor.id]
    );
    await invalidateChatsCacheForUsers([actor.id]);

    const ordered = rows.slice().reverse().map(mapMessageRow);
    res.status(200).json({ ok: true, page, limit, offset, dialogId, items: ordered });
  })
);

app.get(
  '/api/chats',
  requireAuth,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const { limit, offset, page } = parsePagination(req);

    const cached = await getCachedChats(actor.id, page, limit);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

	    const { rows } = await pool.query(
	      `
	        SELECT
	          d.id,
	          d.kind,
	          d.created_at AS "createdAt",
	          d.updated_at AS "updatedAt",
	          peer.id AS "peerId",
	          peer.username AS "peerUsername",
	          peer.display_name AS "peerDisplayName",
	          peer.avatar_url AS "peerAvatarUrl",
	          peer.is_verified AS "peerIsVerified",
	          peer.bio AS "peerBio",
	          peer.status AS "peerStatus",
	          peer.cover_image_url AS "peerCoverImage",
	          peer.hidden_from_friends AS "peerHiddenFromFriends",
	          peer.role AS "peerRole",
	          peer.banned AS "peerBanned",
	          peer.restricted AS "peerRestricted",
	          peer.created_at AS "peerCreatedAt",
	          peer.updated_at AS "peerUpdatedAt",
	          COALESCE(unread.count, 0) AS "unreadCount",
	          last_message.id AS "lastMessageId",
	          last_message.sender_id AS "lastMessageSenderId",
	          last_message.receiver_id AS "lastMessageReceiverId",
	          last_message.content AS "lastMessageContent",
	          last_message.created_at AS "lastMessageCreatedAt"
	        FROM dialog_members dm
	        JOIN dialogs d ON d.id = dm.dialog_id
	        LEFT JOIN LATERAL (
	          SELECT
	            u.id,
	            u.username,
	            u.display_name,
	            u.avatar_url,
	            u.bio,
	            u.status,
	            u.cover_image_url,
	            u.hidden_from_friends,
	            u.role,
	            u.banned,
	            u.restricted,
	            u.is_verified,
	            u.created_at,
	            u.updated_at
	          FROM users u
	          WHERE u.id = CASE WHEN d.direct_user_a = $1 THEN d.direct_user_b ELSE d.direct_user_a END
	          LIMIT 1
	        ) peer ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            m.id,
            m.sender_id,
            m.receiver_id,
            m.content,
            m.created_at
          FROM messages m
          WHERE m.dialog_id = d.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) last_message ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::INT AS count
          FROM messages m
          WHERE m.dialog_id = d.id
            AND m.receiver_id = $1
            AND m.read_at IS NULL
        ) unread ON TRUE
        WHERE dm.user_id = $1
        ORDER BY COALESCE(last_message.created_at, d.updated_at, d.created_at) DESC
        LIMIT $2 OFFSET $3
      `,
      [actor.id, limit, offset]
    );

    const payload = { ok: true, page, limit, offset, items: rows.map(mapDialogRow) };
    await setCachedChats(actor.id, page, limit, payload);
    res.status(200).json(payload);
  })
);

app.get(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  asyncRoute(async (_req, res) => {
	    const { rows } = await pool.query(
	      `
	        SELECT
	          id,
	          username,
	          email,
	          display_name AS "displayName",
	          avatar_url AS "avatarUrl",
	          bio,
	          status,
	          cover_image_url AS "coverImage",
	          hidden_from_friends AS "hiddenFromFriends",
	          role,
	          banned,
	          restricted,
	          is_verified AS "isVerified",
	          email_verification_required AS "emailVerificationRequired",
	          created_at AS "createdAt",
	          updated_at AS "updatedAt"
	        FROM users
	        ORDER BY created_at DESC
	      `
	    );

    res.status(200).json({ ok: true, items: rows });
  })
);

app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const actor = req.user;
    const targetUserId = sanitize(req.params.id);
    if (!isUUID(targetUserId)) throw new HttpError(400, 'Invalid user id.');

    const updates = [];
    const values = [];
    let index = 1;

    if (req.body.role !== undefined) {
      const role = sanitize(req.body.role).toLowerCase();
      if (!ADMIN_ROLES.has(role)) throw new HttpError(400, 'Invalid role.');
      if (targetUserId === actor.id && role !== 'admin') {
        throw new HttpError(400, 'You cannot remove your own admin role.');
      }
      updates.push(`role = $${index}`);
      values.push(role);
      index += 1;
    }
    if (req.body.banned !== undefined) {
      const banned = Boolean(req.body.banned);
      if (targetUserId === actor.id && banned) {
        throw new HttpError(400, 'You cannot ban yourself.');
      }
      updates.push(`banned = $${index}`);
      values.push(banned);
      index += 1;
    }
    if (req.body.restricted !== undefined) {
      updates.push(`restricted = $${index}`);
      values.push(Boolean(req.body.restricted));
      index += 1;
    }
    if (req.body.isVerified !== undefined) {
      updates.push(`is_verified = $${index}`);
      values.push(Boolean(req.body.isVerified));
      index += 1;
      updates.push(`email_verification_required = $${index}`);
      values.push(!Boolean(req.body.isVerified));
      index += 1;
    }

    if (!updates.length) throw new HttpError(400, 'No fields provided for update.');

    values.push(targetUserId);

    const { rows } = await pool.query(
      `
        UPDATE users
        SET ${updates.join(', ')},
            updated_at = NOW()
        WHERE id = $${index}
        RETURNING
          id,
          username,
          email,
          display_name AS "displayName",
          avatar_url AS "avatarUrl",
          bio,
          role,
          banned,
          restricted,
          is_verified AS "isVerified",
          email_verification_required AS "emailVerificationRequired",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      values
    );

    const updatedUser = rows[0];
    if (!updatedUser) throw new HttpError(404, 'User not found.');

    res.status(200).json({ ok: true, user: updatedUser });
  })
);

app.delete(
  '/api/admin/posts/:id',
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const postId = sanitize(req.params.id);
    if (!isUUID(postId)) throw new HttpError(400, 'Invalid post id.');

    const { rows } = await pool.query('SELECT user_id AS "userId" FROM posts WHERE id = $1 LIMIT 1', [postId]);
    if (!rows[0]) throw new HttpError(404, 'Post not found.');

    await pool.query('DELETE FROM posts WHERE id = $1', [postId]);

    const authorId = rows[0].userId;
    const { rows: followerRows } = await pool.query(
      'SELECT follower_id AS "followerId" FROM follows WHERE following_id = $1',
      [authorId]
    );
    const cacheTargets = [authorId, ...followerRows.map((item) => item.followerId)];
    await invalidateFeedCacheForUsers(cacheTargets);

    res.status(200).json({ ok: true });
  })
);

app.get(
  '/api/admin/sql/export',
  requireAuth,
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const sqlDump = await createSqlDump();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aura-backup-${timestamp}.sql"`);
    res.status(200).send(sqlDump);
  })
);

app.post(
  '/api/admin/sql/import',
  requireAuth,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const payload = typeof req.body === 'string' ? req.body : '';
    const sql = payload.trim();
    if (!sql) throw new HttpError(400, 'SQL payload is empty.');

    await pool.query(sql);

    if (redisReady) {
      await redis.flushDb();
    }

    res.status(200).json({ ok: true, message: 'SQL import completed.' });
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

  if (redisPubSubReady || redisSubscriber.isOpen) {
    try {
      if (redisPubSubReady) {
        await redisSubscriber.unsubscribe(WS_MESSAGE_CHANNEL);
      }
      await redisSubscriber.quit();
    } catch {
      // ignore redis subscriber shutdown errors
    }
  }

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
  await ensureDatabaseReady();

  try {
    await redis.connect();
    redisReady = true;
    try {
      await redisSubscriber.connect();
      await redisSubscriber.subscribe(WS_MESSAGE_CHANNEL, (raw) => {
        try {
          const message = JSON.parse(String(raw));
          wsBroadcastLocalMessage(message);
        } catch {
          // ignore malformed payload from pub/sub channel
        }
      });
      redisPubSubReady = true;
    } catch {
      redisPubSubReady = false;
      if (nodeEnv !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Redis pub/sub is unavailable. WebSocket fan-out is local-only.');
      }
    }
  } catch {
    redisReady = false;
    redisPubSubReady = false;
    if (nodeEnv !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('Redis is unavailable. Running without cache-backed features.');
    }
  }

  server.listen(port);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

start().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start sync server:', error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
