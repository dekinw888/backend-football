-- Safe production migration: creates the wallet request table without dropping data.
CREATE TABLE IF NOT EXISTS wallet_requests (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  wallet VARCHAR(100),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS wallet_requests_user_id_idx ON wallet_requests(user_id);
CREATE INDEX IF NOT EXISTS wallet_requests_status_idx ON wallet_requests(status);
