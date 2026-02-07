CREATE TABLE IF NOT EXISTS aura_state (
  id SMALLINT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state JSONB
);

INSERT INTO aura_state (id, revision, updated_at, state)
VALUES (1, 0, NOW(), NULL)
ON CONFLICT (id) DO NOTHING;
