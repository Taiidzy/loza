CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  device TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX sessions_presence_idx ON sessions (last_seen_at DESC);
CREATE INDEX sessions_username_idx ON sessions (username);
