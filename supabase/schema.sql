DROP TABLE IF EXISTS bet_ticket_items CASCADE;
DROP TABLE IF EXISTS bet_tickets CASCADE;
DROP TABLE IF EXISTS wallet_requests CASCADE;
DROP TABLE IF EXISTS bets CASCADE;
DROP TABLE IF EXISTS odds CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'USER',
  status VARCHAR(20) DEFAULT 'APPROVED',
  balance NUMERIC(10, 2) DEFAULT 1000.00,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE wallet_requests (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  wallet VARCHAR(100),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  home_team VARCHAR(100),
  away_team VARCHAR(100),
  kickoff_time TIMESTAMP DEFAULT NOW(),
  home_score INT DEFAULT 0,
  away_score INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'OPEN'
);

CREATE TABLE odds (
  id SERIAL PRIMARY KEY,
  match_id INT REFERENCES matches(id) ON DELETE CASCADE,
  hdp_home NUMERIC(5,2) DEFAULT 0,
  hdp_away NUMERIC(5,2) DEFAULT 0,
  over_under NUMERIC(5,2) DEFAULT 0,
  odds_home NUMERIC(5,2) DEFAULT 0.9,
  odds_away NUMERIC(5,2) DEFAULT 0.9,
  odds_over NUMERIC(5,2) DEFAULT 0.9,
  odds_under NUMERIC(5,2) DEFAULT 0.9,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bets (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  match_id INT REFERENCES matches(id) ON DELETE CASCADE,
  bet_type VARCHAR(10),
  bet_selection VARCHAR(10),
  stake NUMERIC(10,2),
  odds_rate NUMERIC(5,2) DEFAULT 1.0,
  status VARCHAR(20) DEFAULT 'PENDING',
  payout NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bet_tickets (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  stake NUMERIC(12,2) NOT NULL CHECK (stake > 0),
  multiplier NUMERIC(10,4) NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  payout NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bet_ticket_items (
  id SERIAL PRIMARY KEY,
  ticket_id INT REFERENCES bet_tickets(id) ON DELETE CASCADE,
  match_id INT REFERENCES matches(id) ON DELETE CASCADE,
  bet_type VARCHAR(10) NOT NULL,
  bet_selection VARCHAR(10) NOT NULL,
  odds_rate NUMERIC(5,2) NOT NULL
  ,result VARCHAR(20) DEFAULT 'PENDING'
);

INSERT INTO matches (home_team, away_team, kickoff_time)
VALUES ('Man City', 'Liverpool', NOW());

INSERT INTO odds (match_id, hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under)
VALUES (1, -0.5, 0.5, 2.5, 0.95, 0.95, 0.90, 1.00);
