const db = require('../config/db');
const socketService = require('../services/socket');

// วางเดิมพัน (หักเงินทันที + บันทึกโพย)
exports.placeBet = async (req, res) => {
  const userId = req.user.id;
  const { match_id, bet_type, bet_selection, stake } = req.body;
  const numericStake = Number(stake);
  const validTypes = new Set(['HDP', 'OU']);
  const validSelections = new Set(['HOME', 'AWAY', 'OVER', 'UNDER']);

  const validSelectionForType = (bet_type === 'HDP' && ['HOME', 'AWAY'].includes(bet_selection))
    || (bet_type === 'OU' && ['OVER', 'UNDER'].includes(bet_selection));
  if (!Number.isFinite(numericStake) || numericStake <= 0 || !validTypes.has(bet_type)
    || !validSelections.has(bet_selection) || !validSelectionForType) {
    return res.status(400).json({ message: 'Invalid stake amount' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN'); // เริ่ม Transaction เพื่อความปลอดภัยของระบบเงิน

    // 1. ดึงข้อมูล User และเช็กยอดเงินคงเหลือ
    const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = userRes.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    if (parseFloat(user.balance) < numericStake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });