const db = require('../config/db');

const WHEEL_REWARDS = [
  { amount: 2000, weight: 50 },
  { amount: 5000, weight: 30 },
  { amount: 10000, weight: 15 },
  { amount: 50000, weight: 4.5 },
  { amount: 100000, weight: 0.5 }
];

function drawWheelReward() {
  const roll = Math.random() * 100;
  let cursor = 0;
  for (const reward of WHEEL_REWARDS) {
    cursor += reward.weight;
    if (roll < cursor) return reward.amount;
  }
  return WHEEL_REWARDS[0].amount;
}

exports.getStatus = async (req, res) => {
  try {
    const [wheel, checkin] = await Promise.all([
      db.query(
        `SELECT EXISTS(
           SELECT 1 FROM user_reward_claims
           WHERE user_id = $1 AND reward_type = 'LUCKY_WHEEL' AND reward_date = CURRENT_DATE
         ) AS claimed`,
        [req.user.id]
      ),
      db.query(
        'SELECT streak, last_checkin_date FROM user_checkin_state WHERE user_id = $1',
        [req.user.id]
      )
    ]);
    const state = checkin.rows[0] || {};
    res.json({
      wheelClaimed: wheel.rows[0].claimed,
      streak: Number(state.streak || 0),
      lastCheckinDate: state.last_checkin_date || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.claimWheel = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const amount = drawWheelReward();
    const claim = await client.query(
      `INSERT INTO user_reward_claims (user_id, reward_type, reward_date, amount)
       VALUES ($1, 'LUCKY_WHEEL', CURRENT_DATE, $2)
       ON CONFLICT (user_id, reward_type, reward_date) DO NOTHING
       RETURNING amount`,
      [req.user.id, amount]
    );
    if (!claim.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Lucky Wheel already claimed today' });
    }
    const user = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ amount: Number(amount), balance: Number(user.rows[0].balance) });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.claimDailyCheckin = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT streak, last_checkin_date FROM user_checkin_state WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );
    const state = existing.rows[0];
    if (state && String(state.last_checkin_date).slice(0, 10) === new Date().toISOString().slice(0, 10)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Daily Check-in already claimed today' });
    }
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const isConsecutive = state && String(state.last_checkin_date).slice(0, 10) === yesterday.toISOString().slice(0, 10);
    const streak = isConsecutive ? Number(state.streak) + 1 : 1;
    const completed = streak >= 7;
    const amount = completed ? 15000 : 2000;
    await client.query(
      `INSERT INTO user_checkin_state (user_id, streak, last_checkin_date)
       VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET streak = $2, last_checkin_date = CURRENT_DATE`,
      [req.user.id, completed ? 0 : streak]
    );
    await client.query(
      `INSERT INTO user_reward_claims (user_id, reward_type, reward_date, amount)
       VALUES ($1, 'DAILY_CHECKIN', CURRENT_DATE, $2)`,
      [req.user.id, amount]
    );
    const user = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ amount, balance: Number(user.rows[0].balance), streak: completed ? 0 : streak, completed });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
