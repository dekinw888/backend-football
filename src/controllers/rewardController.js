const db = require('../config/db');

const WHEEL_MIN_STAKE = 20000; // ต้องเดิมพันขั้นต่ำเท่านี้ในวันนี้ ถึงจะมีสิทธิ์หมุนวงล้อ

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

// รวมยอดเดิมพัน "วันนี้" (ตามเวลาไทย) ทั้งจากบิลเดี่ยวและบิลสเต็ป
async function getTodayWageredAmount(queryable, userId) {
  const result = await queryable.query(
    `SELECT
       COALESCE((
         SELECT SUM(stake) FROM bets
         WHERE user_id = $1
           AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
       ), 0)
       +
       COALESCE((
         SELECT SUM(stake) FROM bet_tickets
         WHERE user_id = $1
           AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
       ), 0) AS total`,
    [userId]
  );
  return Number(result.rows[0].total || 0);
}

exports.getStatus = async (req, res) => {
  try {
    const today = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;
    const [wheel, checkin] = await Promise.all([
      db.query(
        `SELECT EXISTS(
           SELECT 1 FROM user_reward_claims
           WHERE user_id = $1 AND reward_type = 'LUCKY_WHEEL' AND reward_date = ${today}
         ) AS claimed`,
        [req.user.id]
      ),
      db.query(
        `INSERT INTO user_checkin_state (user_id, streak, last_checkin_date)
         VALUES ($1, 1, ${today})
         ON CONFLICT (user_id) DO UPDATE SET
           streak = CASE
             WHEN user_checkin_state.last_checkin_date = ${today} THEN user_checkin_state.streak
             WHEN user_checkin_state.last_checkin_date = ${today} - 1
               THEN LEAST(user_checkin_state.streak + 1, 7)
             ELSE 1
           END,
           last_checkin_date = CASE
             WHEN user_checkin_state.last_checkin_date = ${today} THEN user_checkin_state.last_checkin_date
             ELSE ${today}
           END
         RETURNING streak, last_checkin_date`,
        [req.user.id]
      )
    ]);
    const state = checkin.rows[0] || {};
    const dailyClaim = await db.query(
      `SELECT EXISTS(
         SELECT 1 FROM user_reward_claims
         WHERE user_id = $1 AND reward_type = 'DAILY_CHECKIN' AND reward_date = ${today}
       ) AS claimed`,
      [req.user.id]
    );
    const todayWagered = await getTodayWageredAmount(db, req.user.id);
    res.json({
      wheelClaimed: wheel.rows[0].claimed,
      wheelMinStake: WHEEL_MIN_STAKE,
      todayWagered,
      wheelEligible: todayWagered >= WHEEL_MIN_STAKE,
      streak: Number(state.streak || 0),
      lastCheckinDate: state.last_checkin_date || null,
      checkinClaimed: dailyClaim.rows[0].claimed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.claimWheel = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // เช็คขั้นต่ำฝั่งเซิร์ฟเวอร์เสมอ ห้ามพึ่งแค่ปุ่มฝั่งหน้าเว็บ (ป้องกันคนเรียก API ตรงๆ)
    const todayWagered = await getTodayWageredAmount(client, req.user.id);
    if (todayWagered < WHEEL_MIN_STAKE) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        message: `ต้องเดิมพันขั้นต่ำ ${WHEEL_MIN_STAKE.toLocaleString()} FDL ในวันนี้ก่อน ถึงจะมีสิทธิ์หมุนวงล้อ (ตอนนี้เดิมพันไปแล้ว ${todayWagered.toLocaleString()} FDL)`,
        wheelMinStake: WHEEL_MIN_STAKE,
        todayWagered
      });
    }

    const amount = drawWheelReward();
    const claim = await client.query(
      `INSERT INTO user_reward_claims (user_id, reward_type, reward_date, amount)
       VALUES ($1, 'LUCKY_WHEEL', (NOW() AT TIME ZONE 'Asia/Bangkok')::date, $2)
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
    const today = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;
    const existing = await client.query(
      'SELECT streak, last_checkin_date FROM user_checkin_state WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );
    const state = existing.rows[0];
    const claimed = await client.query(
      `SELECT 1 FROM user_reward_claims
       WHERE user_id = $1 AND reward_type = 'DAILY_CHECKIN' AND reward_date = ${today}`,
      [req.user.id]
    );
    if (claimed.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Daily Check-in reward already claimed' });
    }
    const streak = Number(state?.streak || 0);
    if (streak < 7) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `ล็อกอินต่อเนื่องแล้ว ${streak}/7 วัน ยังรับรางวัลไม่ได้` });
    }
    const amount = 15000;
    await client.query(
      `INSERT INTO user_reward_claims (user_id, reward_type, reward_date, amount)
       VALUES ($1, 'DAILY_CHECKIN', ${today}, $2)`,
      [req.user.id, amount]
    );
    await client.query(
      'UPDATE user_checkin_state SET streak = 0 WHERE user_id = $1',
      [req.user.id]
    );
    const user = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ amount, balance: Number(user.rows[0].balance), streak: 0, completed: true });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
