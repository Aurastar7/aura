BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

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
  username CITEXT UNIQUE NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  banned BOOLEAN NOT NULL DEFAULT false,
  restricted BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  email_verification_required BOOLEAN NOT NULL DEFAULT true,
  hidden_from_friends BOOLEAN NOT NULL DEFAULT false,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_friends BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  target_email CITEXT,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, purpose),
  CONSTRAINT email_verification_codes_purpose_check CHECK (
    purpose IN ('register', 'change_email')
  )
);

ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS target_email CITEXT;
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS dialogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'direct',
  direct_user_a UUID REFERENCES users(id) ON DELETE CASCADE,
  direct_user_b UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dialogs_not_self CHECK (
    direct_user_a IS NULL
    OR direct_user_b IS NULL
    OR direct_user_a <> direct_user_b
  )
);

ALTER TABLE dialogs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE dialogs ADD COLUMN IF NOT EXISTS direct_user_a UUID;
ALTER TABLE dialogs ADD COLUMN IF NOT EXISTS direct_user_b UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialogs_direct_pair_unique'
  ) THEN
    ALTER TABLE dialogs
      ADD CONSTRAINT dialogs_direct_pair_unique UNIQUE (direct_user_a, direct_user_b);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS dialog_members (
  dialog_id UUID NOT NULL REFERENCES dialogs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (dialog_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_reposts (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_comment_likes (
  comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_not_self CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dialog_id UUID REFERENCES dialogs(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS dialog_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_dialog_id_fkey'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_dialog_id_fkey
      FOREIGN KEY (dialog_id) REFERENCES dialogs(id) ON DELETE CASCADE;
  END IF;
END;
$$;

INSERT INTO dialogs (kind, direct_user_a, direct_user_b)
SELECT
  'direct',
  LEAST(m.sender_id, m.receiver_id),
  GREATEST(m.sender_id, m.receiver_id)
FROM messages m
WHERE m.dialog_id IS NULL
GROUP BY LEAST(m.sender_id, m.receiver_id), GREATEST(m.sender_id, m.receiver_id)
ON CONFLICT (direct_user_a, direct_user_b) DO NOTHING;

UPDATE messages m
SET dialog_id = d.id
FROM dialogs d
WHERE
  m.dialog_id IS NULL
  AND d.kind = 'direct'
  AND d.direct_user_a = LEAST(m.sender_id, m.receiver_id)
  AND d.direct_user_b = GREATEST(m.sender_id, m.receiver_id);

INSERT INTO dialog_members (dialog_id, user_id)
SELECT d.id, d.direct_user_a
FROM dialogs d
WHERE d.kind = 'direct' AND d.direct_user_a IS NOT NULL
ON CONFLICT (dialog_id, user_id) DO NOTHING;

INSERT INTO dialog_members (dialog_id, user_id)
SELECT d.id, d.direct_user_b
FROM dialogs d
WHERE d.kind = 'direct' AND d.direct_user_b IS NOT NULL
ON CONFLICT (dialog_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allow_member_posts BOOLEAN NOT NULL DEFAULT true,
  avatar_url TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS admin_id UUID;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allow_member_posts BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS cover_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_name_lower_unique ON groups (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_groups_admin ON groups(admin_id);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_members_role_check CHECK (role IN ('admin', 'member')),
  CONSTRAINT group_members_unique UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_type TEXT,
  media_url TEXT,
  repost_of_post_id UUID REFERENCES group_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_posts_group_created ON group_posts(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_posts_author_created ON group_posts(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_post_likes (
  group_post_id UUID NOT NULL REFERENCES group_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_post_likes_post ON group_post_likes(group_post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_post_likes_user ON group_post_likes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_post_reposts (
  group_post_id UUID NOT NULL REFERENCES group_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_post_reposts_post ON group_post_reposts(group_post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_post_reposts_user ON group_post_reposts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_post_id UUID NOT NULL REFERENCES group_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_post_comments_post_created ON group_post_comments(group_post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS group_post_comment_likes (
  group_post_comment_id UUID NOT NULL REFERENCES group_post_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_post_comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_post_comment_likes_comment ON group_post_comment_likes(group_post_comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_post_comment_likes_user ON group_post_comment_likes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_email_codes_expires ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialogs_pair ON dialogs(direct_user_a, direct_user_b);
CREATE INDEX IF NOT EXISTS idx_dialog_members_user ON dialog_members(user_id, dialog_id);
CREATE INDEX IF NOT EXISTS idx_messages_dialog_created ON messages(dialog_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pair_created ON messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pair_created_reverse ON messages(receiver_id, sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages(receiver_id, read_at);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_reposts_post ON post_reposts(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_reposts_user ON post_reposts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_created ON post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_author_created ON post_comments(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_comment ON post_comment_likes(comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_user ON post_comment_likes(user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TRIGGER IF EXISTS trg_email_verification_codes_updated_at ON email_verification_codes;
DROP TRIGGER IF EXISTS trg_dialogs_updated_at ON dialogs;
DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
DROP TRIGGER IF EXISTS trg_post_comments_updated_at ON post_comments;
DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;
DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups;
DROP TRIGGER IF EXISTS trg_group_posts_updated_at ON group_posts;
DROP TRIGGER IF EXISTS trg_group_post_comments_updated_at ON group_post_comments;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_verification_codes_updated_at
BEFORE UPDATE ON email_verification_codes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_dialogs_updated_at
BEFORE UPDATE ON dialogs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_posts_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_post_comments_updated_at
BEFORE UPDATE ON post_comments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_groups_updated_at
BEFORE UPDATE ON groups
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_group_posts_updated_at
BEFORE UPDATE ON group_posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_group_post_comments_updated_at
BEFORE UPDATE ON group_post_comments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
