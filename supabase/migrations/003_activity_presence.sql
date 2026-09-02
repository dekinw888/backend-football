-- Safe production migration: tracks visits and recent authenticated activity.
CREATE TABLE IF NOT EXISTS site_stats (
  id INTEGER PRIMARY KEY,
  visit_count BIGINT NOT NULL DEFAULT 0
);

INSERT INTO site_stats (id, visit_count)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen TIMESTAMP NOT NULL DEFAULT NOW()
);
