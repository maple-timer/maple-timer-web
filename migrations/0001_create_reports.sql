CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved',
  reason TEXT,
  message TEXT,
  contact TEXT,
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  payload_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS reports_source_idx ON reports (source);
CREATE INDEX IF NOT EXISTS reports_kind_idx ON reports (kind);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);

CREATE TABLE IF NOT EXISTS report_assets (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS report_assets_report_id_idx ON report_assets (report_id);
