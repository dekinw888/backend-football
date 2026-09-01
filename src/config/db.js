const { Pool } = require('pg');
require('dotenv').config();

// Support either a DATABASE_URL (e.g. Supabase) or individual DB_* env vars.
const connectionString = process.env.DATABASE_URL || undefined;

const poolConfig = connectionString
  ? { connectionString, ssl: { rejectUnauthorized: false } }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    };

const pool = new Pool(poolConfig);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};