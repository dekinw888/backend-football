const db = require('../config/db');

// [ADMIN] กรอกผลสกอร์และคำนวณผลการเดิมพันทั้งหมด
exports.settleMatch = async (req, res) => {
  const { matchId } = req.params;
  const { home_score, away_score } = req.body;

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. อัปเดตผลสกอร์และเปลี่ยนสถานะแมตช์เป็น FINISHED
    await client.query(
      `UPDATE matches 
       SET home_score = $1, away_score = $2, status = 'FINISHED' 
       WHERE id = $3`,
      [home_score, away_score, matchId]
    );

    // 2. ดึงราคาต่อรองของแมตช์นี้
    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = $1', [matchId]);
    const odds = oddsRes.rows[0];

    // 3. ดึงโพยแทงบอลทั้งหมดของแมตช์นี้ที่ยัง PENDING
    const betsRes = await client.query(
      `SELECT * FROM bets WHERE match_id = $1 AND status = 'PENDING'`,
      [matchId]
    );
    const bets = betsRes.rows;

    const totalHome = home_score + odds.hdp_home;
    const totalAway = away_score + odds.hdp_away;
    const totalGoals = home_score + away_score;

    // 4. ลูปคำนวณผลแต่ละโพย
    for (let bet of bets) {
      let isWin = false;
      let payout = 0;
      const stake = parseFloat(bet.stake);
      const rate = parseFloat(bet.odds_rate);

      if (bet.bet_type === 'HDP') {
        if (bet.bet_selection === 'HOME' && totalHome > totalAway) isWin = true;
        if (bet.bet_selection === 'AWAY' && totalAway > totalHome) isWin = true;
      } else if (bet.bet_type === 'OU') {
        if (bet.bet_selection === 'OVER' && totalGoals > odds.over_under) isWin = true;
        if (bet.bet_selection === 'UNDER' && totalGoals < odds.over_under) isWin = true;
      }

      if (isWin) {
        payout = stake + (stake * rate); // คำนวณเงินรางวัล (ทุน + กำไร)
        
        // อัปเดตโพยเป็น WIN
        await client.query(
          `UPDATE bets SET status = 'WIN', payout = $1 WHERE id = $2`,
          [payout, bet.id]
        );

        // โอนเงินเข้าบัญชีผู้ชนะ
        await client.query(
          `UPDATE users SET balance = balance + $1 WHERE id = $2`,
          [payout, bet.user_id]
        );
      } else {
        // อัปเดตโพยเป็น LOSS
        await client.query(
          `UPDATE bets SET status = 'LOSS', payout = 0 WHERE id = $1`,
          [bet.id]
        );
      }
    }

    await client.query('COMMIT');

    res.json({
      message: `Match settled successfully. Processed ${bets.length} bets.`,
      scores: { home_score, away_score }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};