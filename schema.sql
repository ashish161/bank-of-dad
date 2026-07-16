-- Bank of Dad — minimal auth + state schema (Cloudflare D1 / SQLite)
CREATE TABLE IF NOT EXISTS magic_tokens (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 of the emailed token (raw token never stored)
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL       -- unix seconds; 15-min TTL, single-use
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,      -- opaque cookie value
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL       -- unix seconds; 30-day
);
CREATE TABLE IF NOT EXISTS family_state (
  email      TEXT PRIMARY KEY,      -- one JSON blob per family (per email)
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_email ON magic_tokens(email);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
