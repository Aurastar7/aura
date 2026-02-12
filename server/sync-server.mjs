import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
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

const jsonHeaders = {
  'Access-Control-Allow-Origin': corsOrigin,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

const noContentHeaders = {
  'Access-Control-Allow-Origin': corsOrigin,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
};

const sendNoContent = (res, status = 204) => {
  res.writeHead(status, noContentHeaders);
  res.end();
};

const parseBody = async (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const pickPagination = (url) => {
  const page = Math.max(Number(url.searchParams.get('page') || '1') || 1, 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '20') || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
};

const baseUserSelect = `
  id,
  username,
  email,
  display_name AS "displayName",
  bio,
  avatar_url AS "avatarUrl",
  cover_url AS "coverUrl",
  role,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const parseBearer = (req) => {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Bearer ')) return null;
  return value.slice(7).trim();
};

const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      role: user.role,
      username: user.username,
    },
    jwtSecret,
    { expiresIn: '7d' }
  );

const getAuthUser = async (req, res) => {
  const token = parseBearer(req);
  if (!token) {
    sendJson(res, 401, { ok: false, message: 'Unauthorized.' });
    return null;
  }
  if (!jwtSecret) {
    sendJson(res, 500, { ok: false, message: 'JWT secret is not configured.' });
    return null;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    sendJson(res, 401, { ok: false, message: 'Invalid token.' });
    return null;
  }

  const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
  if (!userId || typeof userId !== 'string') {
    sendJson(res, 401, { ok: false, message: 'Invalid token payload.' });
    return null;
  }

  const { rows } = await pool.query(
    `SELECT ${baseUserSelect} FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) {
    sendJson(res, 401, { ok: false, message: 'User not found.' });
    return null;
  }

  return rows[0];
};

const getOptionalAuthUser = async (req) => {
  const token = parseBearer(req);
  if (!token || !jwtSecret) return null;
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
    if (!userId || typeof userId !== 'string') return null;
    const { rows } = await pool.query(
      `SELECT ${baseUserSelect} FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
};

const mapPost = (row) => ({
  id: row.id,
  userId: row.userId,
  text: row.text,
  mediaUrl: row.mediaUrl,
  mediaType: row.mediaType,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  author: {
    id: row.authorId,
    username: row.authorUsername,
    displayName: row.authorDisplayName,
    avatarUrl: row.authorAvatarUrl,
  },
  likeCount: Number(row.likeCount || 0),
  commentCount: Number(row.commentCount || 0),
  likedByMe: Boolean(row.likedByMe),
});

const mapComment = (row) => ({
  id: row.id,
  postId: row.postId,
  userId: row.userId,
  parentId: row.parentId,
  text: row.text,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  author: {
    id: row.authorId,
    username: row.authorUsername,
    displayName: row.authorDisplayName,
    avatarUrl: row.authorAvatarUrl,
  },
});

const mapMessage = (row) => ({
  id: row.id,
  conversationId: row.conversationId,
  senderId: row.senderId,
  text: row.text,
  mediaUrl: row.mediaUrl,
  mediaType: row.mediaType,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const wsAuthBySocket = new WeakMap();
const wss = new WebSocketServer({ noServer: true });

const sendWs = (socket, payload) => {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
};

const broadcastWs = (payload, targetUserIds = null) => {
  const targetSet = targetUserIds ? new Set(targetUserIds) : null;
  wss.clients.forEach((socket) => {
    if (targetSet) {
      const userId = wsAuthBySocket.get(socket) || null;
      if (!userId || !targetSet.has(userId)) return;
    }
    sendWs(socket, payload);
  });
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendNoContent(res, 204);
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const { pathname } = url;
  const parts = pathname.split('/').filter(Boolean);

  try {
    if ((pathname === '/health' || pathname === '/api/health') && req.method === 'GET') {
      await pool.query('SELECT 1');
      sendJson(res, 200, { ok: true, service: 'aura-api', timestamp: new Date().toISOString() });
      return;
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const displayName = String(body.displayName || username).trim();

      if (!username || username.length < 3) {
        sendJson(res, 400, { ok: false, message: 'Username must be at least 3 characters.' });
        return;
      }
      if (!email || !email.includes('@')) {
        sendJson(res, 400, { ok: false, message: 'Email is invalid.' });
        return;
      }
      if (!password || password.length < 6) {
        sendJson(res, 400, { ok: false, message: 'Password must be at least 6 characters.' });
        return;
      }
      if (!jwtSecret) {
        sendJson(res, 500, { ok: false, message: 'JWT secret is not configured.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      try {
        const { rows } = await pool.query(
          `
            INSERT INTO users (username, email, password_hash, display_name)
            VALUES ($1, $2, $3, $4)
            RETURNING ${baseUserSelect}
          `,
          [username, email, passwordHash, displayName || username]
        );
        const user = rows[0];
        const token = signAccessToken(user);
        sendJson(res, 201, { ok: true, token, user });
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          sendJson(res, 409, { ok: false, message: 'Username or email already exists.' });
          return;
        }
        throw error;
      }
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const identity = String(body.username || body.email || body.identity || '').trim();
      const password = String(body.password || '');

      if (!identity || !password) {
        sendJson(res, 400, { ok: false, message: 'Missing credentials.' });
        return;
      }
      if (!jwtSecret) {
        sendJson(res, 500, { ok: false, message: 'JWT secret is not configured.' });
        return;
      }

      const { rows } = await pool.query(
        `
          SELECT id, username, email, password_hash AS "passwordHash", display_name AS "displayName", bio,
                 avatar_url AS "avatarUrl", cover_url AS "coverUrl", role,
                 created_at AS "createdAt", updated_at AS "updatedAt"
          FROM users
          WHERE deleted_at IS NULL AND (username = $1 OR email = $1)
          LIMIT 1
        `,
        [identity]
      );
      const user = rows[0];
      if (!user) {
        sendJson(res, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        sendJson(res, 401, { ok: false, message: 'Invalid credentials.' });
        return;
      }

      const token = signAccessToken(user);
      delete user.passwordHash;
      sendJson(res, 200, { ok: true, token, user });
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'users' && parts[2] && parts.length === 3 && req.method === 'GET') {
      const userId = parts[2];
      const { rows } = await pool.query(
        `SELECT ${baseUserSelect} FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (!rows[0]) {
        sendJson(res, 404, { ok: false, message: 'User not found.' });
        return;
      }
      sendJson(res, 200, { ok: true, user: rows[0] });
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'users' && parts[2] && parts.length === 3 && req.method === 'PUT') {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const userId = parts[2];
      if (actor.id !== userId && actor.role !== 'admin') {
        sendJson(res, 403, { ok: false, message: 'Forbidden.' });
        return;
      }

      const body = await parseBody(req);
      const fields = [];
      const values = [];
      let index = 1;

      const assign = (column, value) => {
        fields.push(`${column} = $${index}`);
        values.push(value);
        index += 1;
      };

      if (body.displayName !== undefined) assign('display_name', String(body.displayName).trim());
      if (body.bio !== undefined) assign('bio', String(body.bio));
      if (body.avatarUrl !== undefined) assign('avatar_url', String(body.avatarUrl));
      if (body.coverUrl !== undefined) assign('cover_url', String(body.coverUrl));
      if (body.email !== undefined) assign('email', String(body.email).trim().toLowerCase());

      if (!fields.length) {
        sendJson(res, 400, { ok: false, message: 'Nothing to update.' });
        return;
      }

      values.push(userId);
      try {
        const { rows } = await pool.query(
          `
            UPDATE users
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${index} AND deleted_at IS NULL
            RETURNING ${baseUserSelect}
          `,
          values
        );

        if (!rows[0]) {
          sendJson(res, 404, { ok: false, message: 'User not found.' });
          return;
        }
        sendJson(res, 200, { ok: true, user: rows[0] });
      } catch (error) {
        if (error && typeof error === 'object' && error.code === '23505') {
          sendJson(res, 409, { ok: false, message: 'Email already exists.' });
          return;
        }
        throw error;
      }
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'users' &&
      parts[2] &&
      parts[3] === 'posts' &&
      parts.length === 4 &&
      req.method === 'GET'
    ) {
      const userId = parts[2];
      const { limit, offset, page } = pickPagination(url);
      const viewer = await getOptionalAuthUser(req);

      const { rows } = await pool.query(
        `
          SELECT
            p.id,
            p.user_id AS "userId",
            p.body AS text,
            p.media_url AS "mediaUrl",
            p.media_type AS "mediaType",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            u.id AS "authorId",
            u.username AS "authorUsername",
            u.display_name AS "authorDisplayName",
            u.avatar_url AS "authorAvatarUrl",
            COALESCE(lc.like_count, 0) AS "likeCount",
            COALESCE(cc.comment_count, 0) AS "commentCount",
            CASE WHEN ul.user_id IS NULL THEN FALSE ELSE TRUE END AS "likedByMe"
          FROM posts p
          JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT AS like_count
            FROM likes l
            WHERE l.post_id = p.id
          ) lc ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT AS comment_count
            FROM comments c
            WHERE c.post_id = p.id AND c.deleted_at IS NULL
          ) cc ON TRUE
          LEFT JOIN likes ul ON ul.post_id = p.id AND ul.user_id = $1
          WHERE p.deleted_at IS NULL AND p.user_id = $2
          ORDER BY p.created_at DESC
          LIMIT $3 OFFSET $4
        `,
        [viewer?.id || null, userId, limit, offset]
      );

      sendJson(res, 200, { ok: true, page, limit, items: rows.map(mapPost) });
      return;
    }

    if (pathname === '/api/posts' && req.method === 'POST') {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const body = await parseBody(req);
      const text = String(body.text || body.body || '').trim();
      const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null;
      const mediaType = body.mediaType ? String(body.mediaType) : null;

      if (!text && !mediaUrl) {
        sendJson(res, 400, { ok: false, message: 'Post is empty.' });
        return;
      }

      const { rows } = await pool.query(
        `
          INSERT INTO posts (user_id, body, media_url, media_type)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            user_id AS "userId",
            body AS text,
            media_url AS "mediaUrl",
            media_type AS "mediaType",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [actor.id, text, mediaUrl, mediaType]
      );

      const post = {
        ...rows[0],
        author: {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
        },
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      };

      broadcastWs({ type: 'post:new', post });
      sendJson(res, 201, { ok: true, post });
      return;
    }

    if (pathname === '/api/posts/feed' && req.method === 'GET') {
      const { limit, offset, page } = pickPagination(url);
      const viewer = await getOptionalAuthUser(req);

      const { rows } = await pool.query(
        `
          SELECT
            p.id,
            p.user_id AS "userId",
            p.body AS text,
            p.media_url AS "mediaUrl",
            p.media_type AS "mediaType",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            u.id AS "authorId",
            u.username AS "authorUsername",
            u.display_name AS "authorDisplayName",
            u.avatar_url AS "authorAvatarUrl",
            COALESCE(lc.like_count, 0) AS "likeCount",
            COALESCE(cc.comment_count, 0) AS "commentCount",
            CASE WHEN ul.user_id IS NULL THEN FALSE ELSE TRUE END AS "likedByMe"
          FROM posts p
          JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT AS like_count
            FROM likes l
            WHERE l.post_id = p.id
          ) lc ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::INT AS comment_count
            FROM comments c
            WHERE c.post_id = p.id AND c.deleted_at IS NULL
          ) cc ON TRUE
          LEFT JOIN likes ul ON ul.post_id = p.id AND ul.user_id = $1
          WHERE p.deleted_at IS NULL
          ORDER BY p.created_at DESC
          LIMIT $2 OFFSET $3
        `,
        [viewer?.id || null, limit, offset]
      );

      sendJson(res, 200, { ok: true, page, limit, items: rows.map(mapPost) });
      return;
    }

    if (parts[0] === 'api' && parts[1] === 'posts' && parts[2] && parts.length === 3 && req.method === 'DELETE') {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const postId = parts[2];
      const { rows } = await pool.query(
        'SELECT id, user_id AS "userId" FROM posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [postId]
      );
      const post = rows[0];
      if (!post) {
        sendJson(res, 404, { ok: false, message: 'Post not found.' });
        return;
      }
      if (post.userId !== actor.id && actor.role !== 'admin') {
        sendJson(res, 403, { ok: false, message: 'Forbidden.' });
        return;
      }

      await pool.query('UPDATE posts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [postId]);
      sendNoContent(res, 204);
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'posts' &&
      parts[2] &&
      parts[3] === 'comments' &&
      parts.length === 4 &&
      req.method === 'POST'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const postId = parts[2];
      const body = await parseBody(req);
      const text = String(body.text || body.body || '').trim();
      const parentId = body.parentId ? String(body.parentId) : null;

      if (!text) {
        sendJson(res, 400, { ok: false, message: 'Comment is empty.' });
        return;
      }

      const postCheck = await pool.query(
        'SELECT id FROM posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
        [postId]
      );
      if (!postCheck.rows[0]) {
        sendJson(res, 404, { ok: false, message: 'Post not found.' });
        return;
      }

      if (parentId) {
        const parentCheck = await pool.query(
          'SELECT id, post_id AS "postId" FROM comments WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
          [parentId]
        );
        const parent = parentCheck.rows[0];
        if (!parent || parent.postId !== postId) {
          sendJson(res, 400, { ok: false, message: 'Invalid parent comment.' });
          return;
        }
      }

      const { rows } = await pool.query(
        `
          INSERT INTO comments (post_id, user_id, parent_id, body)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            post_id AS "postId",
            user_id AS "userId",
            parent_id AS "parentId",
            body AS text,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [postId, actor.id, parentId, text]
      );

      const comment = {
        ...rows[0],
        author: {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
        },
      };

      broadcastWs({ type: 'comment:new', comment, postId });
      sendJson(res, 201, { ok: true, comment });
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'posts' &&
      parts[2] &&
      parts[3] === 'comments' &&
      parts.length === 4 &&
      req.method === 'GET'
    ) {
      const postId = parts[2];
      const { limit, offset, page } = pickPagination(url);

      const { rows } = await pool.query(
        `
          SELECT
            c.id,
            c.post_id AS "postId",
            c.user_id AS "userId",
            c.parent_id AS "parentId",
            c.body AS text,
            c.created_at AS "createdAt",
            c.updated_at AS "updatedAt",
            u.id AS "authorId",
            u.username AS "authorUsername",
            u.display_name AS "authorDisplayName",
            u.avatar_url AS "authorAvatarUrl"
          FROM comments c
          JOIN users u ON u.id = c.user_id AND u.deleted_at IS NULL
          WHERE c.post_id = $1 AND c.deleted_at IS NULL
          ORDER BY c.created_at ASC
          LIMIT $2 OFFSET $3
        `,
        [postId, limit, offset]
      );

      sendJson(res, 200, { ok: true, page, limit, items: rows.map(mapComment) });
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'posts' &&
      parts[2] &&
      parts[3] === 'like' &&
      parts.length === 4 &&
      req.method === 'POST'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const postId = parts[2];
      const { rowCount } = await pool.query(
        `
          INSERT INTO likes (user_id, post_id)
          VALUES ($1, $2)
          ON CONFLICT (user_id, post_id) DO NOTHING
        `,
        [actor.id, postId]
      );

      sendJson(res, rowCount ? 201 : 200, { ok: true });
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'posts' &&
      parts[2] &&
      parts[3] === 'like' &&
      parts.length === 4 &&
      req.method === 'DELETE'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const postId = parts[2];
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [actor.id, postId]);
      sendNoContent(res, 204);
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'users' &&
      parts[2] &&
      parts[3] === 'follow' &&
      parts.length === 4 &&
      req.method === 'POST'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const targetId = parts[2];
      if (targetId === actor.id) {
        sendJson(res, 400, { ok: false, message: 'Cannot follow yourself.' });
        return;
      }

      const target = await pool.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId]);
      if (!target.rows[0]) {
        sendJson(res, 404, { ok: false, message: 'User not found.' });
        return;
      }

      await pool.query(
        `
          INSERT INTO follows (follower_id, following_id)
          VALUES ($1, $2)
          ON CONFLICT (follower_id, following_id) DO NOTHING
        `,
        [actor.id, targetId]
      );

      sendJson(res, 200, { ok: true });
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'users' &&
      parts[2] &&
      parts[3] === 'follow' &&
      parts.length === 4 &&
      req.method === 'DELETE'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const targetId = parts[2];
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [
        actor.id,
        targetId,
      ]);

      sendNoContent(res, 204);
      return;
    }

    if (pathname === '/api/messages' && req.method === 'POST') {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const body = await parseBody(req);
      const text = String(body.text || body.body || '').trim();
      const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null;
      const mediaType = body.mediaType ? String(body.mediaType) : null;
      let conversationId = body.conversationId ? String(body.conversationId) : null;
      const recipientId = body.recipientId ? String(body.recipientId) : null;

      if (!text && !mediaUrl) {
        sendJson(res, 400, { ok: false, message: 'Message is empty.' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (!conversationId) {
          if (!recipientId || recipientId === actor.id) {
            await client.query('ROLLBACK');
            sendJson(res, 400, { ok: false, message: 'Recipient is required.' });
            return;
          }

          const recipient = await client.query(
            'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
            [recipientId]
          );
          if (!recipient.rows[0]) {
            await client.query('ROLLBACK');
            sendJson(res, 404, { ok: false, message: 'Recipient not found.' });
            return;
          }

          const existing = await client.query(
            `
              SELECT cp.conversation_id AS id
              FROM conversation_participants cp
              JOIN conversations c ON c.id = cp.conversation_id AND c.deleted_at IS NULL
              WHERE cp.user_id = ANY($1::uuid[])
              GROUP BY cp.conversation_id
              HAVING COUNT(DISTINCT cp.user_id) = 2 AND COUNT(*) = 2
              LIMIT 1
            `,
            [[actor.id, recipientId]]
          );

          if (existing.rows[0]) {
            conversationId = existing.rows[0].id;
          } else {
            const createdConversation = await client.query(
              'INSERT INTO conversations DEFAULT VALUES RETURNING id'
            );
            conversationId = createdConversation.rows[0].id;
            await client.query(
              `
                INSERT INTO conversation_participants (conversation_id, user_id)
                VALUES ($1, $2), ($1, $3)
              `,
              [conversationId, actor.id, recipientId]
            );
          }
        } else {
          const membership = await client.query(
            `
              SELECT 1
              FROM conversation_participants
              WHERE conversation_id = $1 AND user_id = $2
              LIMIT 1
            `,
            [conversationId, actor.id]
          );
          if (!membership.rows[0]) {
            await client.query('ROLLBACK');
            sendJson(res, 403, { ok: false, message: 'No access to conversation.' });
            return;
          }
        }

        const inserted = await client.query(
          `
            INSERT INTO messages (conversation_id, sender_id, body, media_url, media_type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
              id,
              conversation_id AS "conversationId",
              sender_id AS "senderId",
              body AS text,
              media_url AS "mediaUrl",
              media_type AS "mediaType",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
          `,
          [conversationId, actor.id, text, mediaUrl, mediaType]
        );

        await client.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

        const participants = await client.query(
          'SELECT user_id AS "userId" FROM conversation_participants WHERE conversation_id = $1',
          [conversationId]
        );

        await client.query('COMMIT');

        const message = mapMessage(inserted.rows[0]);
        broadcastWs(
          {
            type: 'message:new',
            message,
          },
          participants.rows.map((row) => row.userId)
        );

        sendJson(res, 201, { ok: true, message });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return;
    }

    if (
      parts[0] === 'api' &&
      parts[1] === 'conversations' &&
      parts[2] &&
      parts[3] === 'messages' &&
      parts.length === 4 &&
      req.method === 'GET'
    ) {
      const actor = await getAuthUser(req, res);
      if (!actor) return;

      const conversationId = parts[2];
      const memberCheck = await pool.query(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 LIMIT 1',
        [conversationId, actor.id]
      );
      if (!memberCheck.rows[0]) {
        sendJson(res, 403, { ok: false, message: 'No access to conversation.' });
        return;
      }

      const { limit, offset, page } = pickPagination(url);
      const { rows } = await pool.query(
        `
          SELECT
            id,
            conversation_id AS "conversationId",
            sender_id AS "senderId",
            body AS text,
            media_url AS "mediaUrl",
            media_type AS "mediaType",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM messages
          WHERE conversation_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `,
        [conversationId, limit, offset]
      );

      sendJson(res, 200, { ok: true, page, limit, items: rows.map(mapMessage) });
      return;
    }

    sendJson(res, 404, { ok: false, message: 'Not found.' });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: 'Internal server error.' });
  }
});

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

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const queryToken = url.searchParams.get('token');
  if (queryToken && jwtSecret) {
    try {
      const decoded = jwt.verify(queryToken, jwtSecret);
      const userId = typeof decoded === 'object' && decoded ? decoded.sub : null;
      if (typeof userId === 'string') {
        wsAuthBySocket.set(ws, userId);
      }
    } catch {
      // ignore invalid token in query
    }
  }

  sendWs(ws, { type: 'hello' });

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

const gracefulShutdown = async () => {
  clearInterval(heartbeat);
  wss.clients.forEach((socket) => socket.close());

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => {
  void gracefulShutdown();
});

process.on('SIGTERM', () => {
  void gracefulShutdown();
});
