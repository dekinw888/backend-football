const db = require('../config/db');

exports.getUsers = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, role, status, balance, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  const { status, balance, role } = req.body;
  if (status && !['APPROVED', 'PENDING', 'REJECTED'].includes(status)) {
    return res.status(400).json({ message: 'Invalid user status' });
  }
  try {
    const result = await db.query(
      `UPDATE users SET
        balance = COALESCE($1, balance),
        role = COALESCE($2, role),
        status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, username, role, status, balance, created_at`,
      [balance === undefined ? null : Number(balance), role || null, status || null, req.params.userId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  if (String(req.params.userId) === String(req.user.id)) {
    return res.status(400).json({ message: 'You cannot delete the active admin account' });
  }
  try {
    const result = await db.query(
      'DELETE FROM users WHERE id = $1 AND role <> $2 RETURNING id, username',
      [req.params.userId, 'ADMIN']
    );
    if (!result.rows.length) return res.status(404).json({ message: 'User not found or cannot be deleted' });
    res.json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// [ADMIN] รายการเดิมพันของลูกค้าทุกคนรวมในหน้าเดียว สำหรับตรวจสอบ
// พร้อมธง is_suspicious อัตโนมัติ: แทงหลังบอลเริ่มแข่งไปแล้วหรือไม่
// (เทียบเวลาที่วางเดิมพันจริง กับเวลาแข่งที่บันทึกไว้ ณ ตอนนี้)
exports.getAllBets = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = (page - 1) * limit;
  const username = (req.query.username || '').trim();
  const suspiciousOnly = req.query.suspiciousOnly === 'true';

  try {
    const conditions = [];
    const params = [];

    if (username) {
      params.push(`%${username}%`);
      conditions.push(`u.username ILIKE $${params.length}`);
    }
    if (suspiciousOnly) {
      conditions.push('b.created_at > m.kickoff_time');
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const singleBets = await db.query(
      `SELECT b.id, u.username, b.bet_type, b.bet_selection, b.stake, b.odds_rate,
              b.status, b.payout, b.created_at,
              m.home_team, m.away_team, m.kickoff_time, m.status AS match_status,
              (b.created_at > m.kickoff_time) AS is_suspicious,
              false AS is_ticket
       FROM bets b
       JOIN users u ON u.id = b.user_id
       JOIN matches m ON m.id = b.match_id
       ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ bets: singleBets.rows, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
