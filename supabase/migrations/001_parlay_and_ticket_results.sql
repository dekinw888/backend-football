-- Safe production migration: does not drop existing users, matches, odds, or bets.
CREATE TABLE IF NOT EXISTS bet_tickets (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  stake NUMERIC(12,2) NOT NULL CHECK (stake > 0),
  multiplier NUMERIC(10,4) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  payout NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bet_ticket_items (
  id SERIAL PRIMARY KEY,
  ticket_id INT REFERENCES bet_tickets(id) ON DELETE CASCADE,
  match_id INT REFERENCES matches(id) ON DELETE CASCADE,
  bet_type VARCHAR(10) NOT NULL,
  bet_selection VARCHAR(10) NOT NULL,
  odds_rate NUMERIC(5,2) NOT NULL,
  result VARCHAR(20) DEFAULT 'PENDING'
);

ALTER TABLE bet_ticket_items
  ADD COLUMN IF NOT EXISTS result VARCHAR(20) DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS bet_ticket_items_match_id_idx ON bet_ticket_items(match_id);
