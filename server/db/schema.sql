BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE app_user_role AS ENUM ('admin', 'user');
CREATE TYPE app_notification_type AS ENUM (
  'follow',
  'post_like',
  'post_comment',
  'comment_reply',
  'message',
  'group_post',
  'group_invite',
  'system'
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username CITEXT NOT NULL UNIQUE,
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  cover_url TEXT,
  role app_user_role NOT NULL DEFAULT 'user',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'gif')),
  repost_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT comments_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE IF NOT EXISTS likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT likes_user_post_unique UNIQUE (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT followers_unique UNIQUE (follower_id, following_id),
  CONSTRAINT followers_no_self CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT conversation_participants_unique UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'file')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug CITEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_url TEXT,
  cover_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role app_user_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT group_members_unique UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'gif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type app_notification_type NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_posts_user_created_at_desc ON posts(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at_desc ON posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_not_deleted ON posts(created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at_desc ON comments(post_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_not_deleted ON comments(post_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);

CREATE INDEX IF NOT EXISTS idx_followers_following_id ON followers(following_id);
CREATE INDEX IF NOT EXISTS idx_followers_follower_id ON followers(follower_id);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON conversation_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at_desc ON messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted ON messages(conversation_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_group_posts_group_created_desc ON group_posts(group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_group_posts_user_created_desc ON group_posts(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_desc ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread_partial ON notifications(user_id, created_at DESC, id DESC)
WHERE is_read = FALSE AND deleted_at IS NULL;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_refresh_tokens_updated_at BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_conversation_participants_updated_at BEFORE UPDATE ON conversation_participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_group_members_updated_at BEFORE UPDATE ON group_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_group_posts_updated_at BEFORE UPDATE ON group_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
