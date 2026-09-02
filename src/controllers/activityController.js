const db = require('../config/db');

exports.recordVisit = async (req, res) => {
  try {
    const result = await db.query(
      `INSERT INTO site_stats (id, visit_count)
       VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET visit_count = site_stats.visit_count + 1
       RETURNING visit_count`
    );
    res.json({ visitCount: Number(result.rows[0].visit_count) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    await db.query(
      `INSERT INTO user_presence (user_id, last_seen)
       VALUES ($1, NOW())
       ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW()`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAdminActivity = async (req, res) => {
  try {
    const [stats, presence] = await Promise.all([
      db.query('SELECT visit_count FROM site_stats WHERE id = 1'),
      db.query(
        `SELECT user_id, last_seen,
          (last_seen >= NOW() - INTERVAL '2 minutes') AS online
         FROM user_presence`
      )
    ]);
    res.json({
      visitCount: Number(stats.rows[0]?.visit_count || 0),
      presence: presence.rows.map(row => ({
        userId: row.user_id,
        lastSeen: row.last_seen,
        online: row.online
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
