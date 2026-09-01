const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  password: '057084332',
  host: 'localhost',
  port: 5432,
  database: 'football_betting'
});

async function createTables() {
  await client.connect();
  
  const queryText = `
    -- ลบตารางเก่าทิ้งเพื่อให้สร้างโครงสร้างใหม่ทั้งหมด
    DROP TABLE IF EXISTS bets CASCADE;
    DROP TABLE IF EXISTS odds CASCADE;
    DROP TABLE IF EXISTS matches CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      balance NUMERIC(10, 2) DEFAULT 1000.00
    );

    CREATE TABLE matches (
      id SERIAL PRIMARY KEY,
      home_team VARCHAR(100),
      away_team VARCHAR(100),
      kickoff_time TIMESTAMP DEFAULT NOW(),
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
      user_id INT REFERENCES users(id),
      match_id INT REFERENCES matches(id),
      bet_type VARCHAR(10),
      bet_selection VARCHAR(10),
      stake NUMERIC(10,2),
      status VARCHAR(20) DEFAULT 'PENDING'
    );

    -- ใส่ข้อมูลทดสอบ
    INSERT INTO matches (id, home_team, away_team, kickoff_time) VALUES (1, 'Man City', 'Liverpool', NOW());
    INSERT INTO odds (match_id, hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under)
    VALUES (1, -0.5, 0.5, 2.5, 0.95, 0.95, 0.90, 1.00);
  `;

  await client.query(queryText);
  console.log('Tables recreated and mock match inserted successfully!');
  client.end();
}

createTables().catch(err => {
  console.error('Error:', err.message);
  client.end();
});