-- Safe production migration for RB CLUB daily rewards.
CREATE TABLE IF NOT EXISTS user_reward_claims (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type VARCHAR(30) NOT NULL,
  reward_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, reward_type, reward_date)
);

CREATE TABLE IF NOT EXISTS user_checkin_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0 AND streak <= 7),
  last_checkin_date DATE
);

ALTER TABLE user_checkin_state DROP CONSTRAINT IF EXISTS user_checkin_state_streak_check;
ALTER TABLE user_checkin_state ADD CONSTRAINT user_checkin_state_streak_check CHECK (streak >= 0 AND streak <= 7);
