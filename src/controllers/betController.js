const db = require('../config/db');

// วางเดิมพัน (หักเงินทันที + บันทึกโพย)
exports.placeBet = async (req, res) => {
  const userId = req.user.id;
  const { match_id, bet_type, bet_selection, stake } = req.body;

  if (!stake || stake <= 0) {
    return res.status(400).json({ message: 'Invalid stake amount' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN'); // เริ่ม Transaction เพื่อความปลอดภัยของระบบเงิน

    // 1. ดึงข้อมูล User และเช็กยอดเงินคงเหลือ
    const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = userRes.rows[0];

    if (parseFloat(user.balance) < parseFloat(stake)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // 2. ดึงราคาต่อรองล่าสุดของแมตช์นั้น
    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = $1', [match_id]);
    if (oddsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Odds not found for this match' });
    }
    const odds = oddsRes.rows[0];

    // 3. กำหนด ค่าน้ำ (Odds) ตามตัวเลือกที่ผู้ใช้แทง
    let oddsRate = 0;
    if (bet_selection === 'HOME') oddsRate = odds.odds_home;
    else if (bet_selection === 'AWAY') oddsRate = odds.odds_away;
    else if (bet_selection === 'OVER') oddsRate = odds.odds_over;
    else if (bet_selection === 'UNDER') oddsRate = odds.odds_under;

    // 4. หักเงินในบัญชี User
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [stake, userId]);

    // 5. บันทึกโพยแทงบอล (Bets)
    const newBet = await client.query(
      `INSERT INTO bets (user_id, match_id, bet_type, bet_selection, stake, odds_rate)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, match_id, bet_type, bet_selection, stake, oddsRate]
    );

    await client.query('COMMIT'); // ยืนยัน Transaction

    res.status(201).json({
      message: 'Bet placed successfully',
      bet: newBet.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ดูประวัติการแทงของตัวเอง
exports.getMyBets = async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
      SELECT b.*, m.home_team, m.away_team 
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC;
    `;
    const result = await db.query(query, [userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};