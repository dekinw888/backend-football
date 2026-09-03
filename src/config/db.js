const { Pool } = require('pg');
require('dotenv').config();

// Support either a DATABASE_URL (e.g. Supabase) or individual DB_* env vars.
const connectionString = process.env.DATABASE_URL || undefined;

// Free-tier Supabase/Render sizing: keep the pool small so we never exceed
// what the DB plan allows, and time everything out instead of hanging.
const sharedTuning = {
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000, // kill runaway queries after 10s
  query_timeout: 10000,
};

const poolConfig = connectionString
  ? { connectionString, ssl: { rejectUnauthorized: false }, ...sharedTuning }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
      ...sharedTuning,
    };

const pool = new Pool(poolConfig);

// Without this handler, an idle client error can crash the whole process.
pool.on('error', (err) => {
  console.error('[db] Unexpected idle client error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
