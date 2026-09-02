const db = require('../config/db');

// ดึงรายการคู่บอลทั้งหมดพร้อมราคาต่อรอง
exports.getAllMatches = async (req, res) => {
  try {
    const query = `
      SELECT m.id, m.home_team, m.away_team, m.kickoff_time, m.status,
             o.id AS odds_id, o.hdp_home, o.hdp_away, o.over_under, o.odds_home, o.odds_away, o.odds_over, o.odds_under
      FROM matches m
      LEFT JOIN odds o ON m.id = o.match_id
      ORDER BY m.kickoff_time ASC;
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// [ADMIN] เพิ่มคู่บอลใหม่
exports.createMatch = async (req, res) => {
  const { home_team, away_team, kickoff_time, hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under } = req.body;
  if (!home_team || !away_team || !kickoff_time) {
    return res.status(400).json({ message: 'home_team, away_team, and kickoff_time are required' });
  }
  const kickoffDate = new Date(kickoff_time);
  if (Number.isNaN(kickoffDate.getTime()) || kickoffDate.getTime() <= Date.now()) {
    return res.status(400).json({ message: 'kickoff_time must be a future date' });
  }
  
  try {
    // 1. สร้างคู่แข่งขัน
    const matchResult = await db.query(
      'INSERT INTO matches (home_team, away_team, kickoff_time) VALUES ($1, $2, $3) RETURNING *',
      [home_team, away_team, kickoff_time]
    );
    const matchId = matchResult.rows[0].id;

    // 2. สร้างราคาต่อรอง
    const oddsResult = await db.query(
      `INSERT INTO odds (match_id, hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [matchId, hdp_home || 0, hdp_away || 0, over_under || 0, odds_home || 0.9, odds_away || 0.9, odds_over || 0.9, odds_under || 0.9]
    );

    res.status(201).json({
      message: 'Match and Odds created successfully',
      match: matchResult.rows[0],
      odds: oddsResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// [ADMIN] อัปเดตราคาต่อรอง
exports.updateOdds = async (req, res) => {
  const { matchId } = req.params;
  const { hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under } = req.body;

  try {
    const matchCheck = await db.query(
      "SELECT id FROM matches WHERE id = $1 AND status = 'OPEN'",
      [matchId]
    );
    if (matchCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Odds can only be changed for an open match' });
    }

    const result = await db.query(
      `UPDATE odds 
       SET hdp_home = $1, hdp_away = $2, over_under = $3, odds_home = $4, odds_away = $5, odds_over = $6, odds_under = $7, updated_at = NOW()
       WHERE match_id = $8 RETURNING *`,
      [hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under, matchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Odds not found for this match' });
    }
    res.json({ message: 'Odds updated successfully', odds: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateMatch = async (req, res) => {
  const { matchId } = req.params;
  const {
    home_team,
    away_team,
    kickoff_time,
    hdp_home,
    hdp_away,
    over_under,
    odds_home,
    odds_away,
    odds_over,
    odds_under,
  } = req.body;

  if (!home_team || !away_team || !kickoff_time) {
    return res.status(400).json({ message: 'home_team, away_team, and kickoff_time are required' });
  }

  const kickoffDate = new Date(kickoff_time);
  if (Number.isNaN(kickoffDate.getTime()) || kickoffDate.getTime() <= Date.now()) {
    return res.status(400).json({ message: 'kickoff_time must be a future date' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const matchResult = await client.query(
      `UPDATE matches SET home_team = $1, away_team = $2, kickoff_time = $3
       WHERE id = $4 AND status = 'OPEN' RETURNING *`,
      [home_team, away_team, kickoff_time, matchId]
    );
    if (matchResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Match not found or is no longer open' });
    }

    const oddsResult = await client.query(
      `UPDATE odds
       SET hdp_home = $1, hdp_away = $2, over_under = $3, odds_home = $4,
           odds_away = $5, odds_over = $6, odds_under = $7, updated_at = NOW()
       WHERE match_id = $8 RETURNING *`,
      [hdp_home, hdp_away, over_under, odds_home, odds_away, odds_over, odds_under, matchId]
    );
    await client.query('COMMIT');
    res.json({ message: 'Match updated successfully', match: matchResult.rows[0], odds: oddsResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};