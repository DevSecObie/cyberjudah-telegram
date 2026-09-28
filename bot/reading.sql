CREATE TABLE IF NOT EXISTS reading_settings (
 user_id INTEGER PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'UTC', time TEXT NOT NULL DEFAULT '08:00',
 enabled INTEGER NOT NULL DEFAULT 0, weekly INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reading_log (
 user_id INTEGER NOT NULL, slug TEXT NOT NULL, chapter INTEGER NOT NULL, day TEXT NOT NULL,
 PRIMARY KEY(user_id, slug, chapter, day)
);
CREATE INDEX IF NOT EXISTS reading_log_days ON reading_log(user_id, day);
CREATE TABLE IF NOT EXISTS reading_deliveries (
 user_id INTEGER NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
 PRIMARY KEY(user_id, kind, day)
);
