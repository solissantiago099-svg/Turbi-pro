CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_state_updated_at
ON app_state(updated_at);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  password_hash TEXT,
  email TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'chofer',
  current_driver_id INTEGER,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_users_role
ON app_users(role);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username
ON app_users(username);

CREATE TABLE IF NOT EXISTS app_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
ON app_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
ON app_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_app_audit_created_at
ON app_audit(created_at);

CREATE INDEX IF NOT EXISTS idx_app_audit_entity
ON app_audit(entity, entity_id);
