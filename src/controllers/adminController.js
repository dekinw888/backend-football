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
