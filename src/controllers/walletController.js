const db = require('../config/db');
const { notifyDeposit, notifyWithdrawal } = require('../services/discordNotifier'); // เรียกใช้บริการแจ้งเตือน

exports.createRequest = async (req, res) => {
  const userId = req.user.id;
  const username = req.user.username; // รับ username เพื่อส่งเข้า Discord
  const { type, amount, wallet } = req.body;
  const numericAmount = Number(amount);
  if (!['deposit', 'withdraw'].includes(type) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: 'Invalid wallet request' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (type === 'withdraw') {
      const user = (await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!user) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'User not found' });
      }
      if (Number(user.balance) < numericAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [numericAmount, userId]);
    }
    const request = await client.query(
      `INSERT INTO wallet_requests (user_id, type, amount, wallet, status)
       VALUES ($1, $2, $3, $4, 'PENDING') RETURNING *`,
      [userId, type === 'deposit' ? 'DEPOSIT' : 'WITHDRAW', numericAmount, wallet || null]
    );
    const balance = (await client.query('SELECT balance FROM users WHERE id = $1', [userId])).rows[0].balance;
    await client.query('COMMIT');

    // --- ส่งแจ้งเตือน Discord หลัง COMMIT สำเร็จ ---
    const createdRequest = request.rows[0];
    if (type === 'deposit') {
      notifyDeposit(username, numericAmount, wallet, createdRequest.id);
    } else if (type === 'withdraw') {
      notifyWithdrawal(username, numericAmount, wallet, createdRequest.id);
    }

    res.status(201).json({ request: createdRequest, balance });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM wallet_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllRequests = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT w.*, u.username FROM wallet_requests w
       JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reviewRequest = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const request = (await client.query(
      'SELECT * FROM wallet_requests WHERE id = $1 FOR UPDATE',
      [req.params.requestId]
    )).rows[0];
    if (!request || request.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Request not found or already reviewed' });
    }

    const nextStatus = req.body.status;
    if (!['APPROVED', 'REJECTED'].includes(nextStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid review status' });
    }
    if (nextStatus === 'APPROVED' && request.type === 'DEPOSIT') {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [request.amount, request.user_id]);
    }
    if (nextStatus === 'REJECTED' && request.type === 'WITHDRAW') {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [request.amount, request.user_id]);
    }
    const updated = await client.query(
      `UPDATE wallet_requests SET status = $1, reviewed_at = NOW()
       WHERE id = $2 RETURNING *`,
      [nextStatus, request.id]
    );
    await client.query('COMMIT');
    res.json({ request: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
