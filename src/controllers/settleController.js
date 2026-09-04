const db = require('../config/db');
const { syncOpenMatchesFromGoal7 } = require('../services/goal7Service');

async function settleMatchById(matchId, home_score, away_score, providedClient) {
  const client = providedClient || (await db.pool.connect());
  const shouldRelease = !providedClient;

  try {
    if (shouldRelease) await client.query('BEGIN');

    const matchUpdate = await client.query(
      `UPDATE matches
       SET home_score = $1, away_score = $2, status = 'FINISHED'
       WHERE id = $3 AND status <> 'FINISHED'
       RETURNING id`,
      [home_score, away_score, matchId]
    );

    if (!matchUpdate.rowCount) {
      if (shouldRelease) await client.query('COMMIT');
      return { processed: 0, scores: { home_score, away_score }, matchId, skipped: true };
    }

    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = $1', [matchId]);
    const odds = oddsRes.rows[0];

    if (!odds) {
      if (shouldRelease) await client.query('COMMIT');