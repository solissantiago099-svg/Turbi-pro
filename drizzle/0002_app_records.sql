CREATE TABLE IF NOT EXISTS app_records (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  date TEXT,
  start TEXT,
  driver_id INTEGER,
  status TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(type, id)
);

CREATE INDEX IF NOT EXISTS idx_app_records_type_date
ON app_records(type, date, start);

CREATE INDEX IF NOT EXISTS idx_app_records_type_driver
ON app_records(type, driver_id, status);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
