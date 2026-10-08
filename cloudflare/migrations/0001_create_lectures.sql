CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  captions_json TEXT NOT NULL DEFAULT '[]',
  translation_language TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lectures_created_at_idx ON lectures(created_at DESC);
