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
  role TEXT NOT NULL DEFAULT 'user',
  banned BOOLEAN NOT NULL DEFAULT false,
  restricted BOOLEAN NOT NULL DEFAULT false,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  email_verification_required BOOLEAN NOT NULL DEFAULT true,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

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

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialogs_pair ON dialogs(direct_user_a, direct_user_b);
CREATE INDEX IF NOT EXISTS idx_dialog_members_user ON dialog_members(user_id, dialog_id);
CREATE INDEX IF NOT EXISTS idx_messages_dialog_created ON messages(dialog_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pair_created ON messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pair_created_reverse ON messages(receiver_id, sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages(receiver_id, read_at);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TRIGGER IF EXISTS trg_dialogs_updated_at ON dialogs;
DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
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

CREATE TRIGGER trg_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
