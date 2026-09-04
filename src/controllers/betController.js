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
    }

    // 2. Lock the match while checking that betting is still open.
    const matchRes = await client.query(
      'SELECT status, kickoff_time FROM matches WHERE id = $1 FOR UPDATE',
      [match_id]
    );
    const match = matchRes.rows[0];
    if (!match) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Match not found' });
    }
    if (match.status !== 'OPEN' || new Date(match.kickoff_time).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Betting is closed for this match' });
    }

    // 3. ดึงราคาต่อรองล่าสุดของแมตช์นั้น
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

    if (!Number.isFinite(Number(oddsRate)) || Number(oddsRate) < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid odds for this selection' });
    }

    // 4. หักเงินในบัญชี User
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [numericStake, userId]);

    // 5. บันทึกโพยแทงบอล (Bets)
    const newBet = await client.query(
      `INSERT INTO bets (user_id, match_id, bet_type, bet_selection, stake, odds_rate)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, match_id, bet_type, bet_selection, numericStake, oddsRate]
    );

    await client.query('COMMIT'); // ยืนยัน Transaction
    socketService.emitSafe('bets:updated', { userId });

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

exports.placeBetsBatch = async (req, res) => {
  const userId = req.user.id;
  const items = Array.isArray(req.body.bets) ? req.body.bets : [];
  const validTypes = new Set(['HDP', 'OU']);
  const validSelections = new Set(['HOME', 'AWAY', 'OVER', 'UNDER']);

  if (!items.length || items.some((item) => {
    const validSelectionForType = (item && item.bet_type === 'HDP' && ['HOME', 'AWAY'].includes(item.bet_selection))
      || (item && item.bet_type === 'OU' && ['OVER', 'UNDER'].includes(item.bet_selection));
    return !item || !validTypes.has(item.bet_type) || !validSelections.has(item.bet_selection)
      || !validSelectionForType || !Number.isFinite(Number(item.stake)) || Number(item.stake) <= 0;
  })) {
    return res.status(400).json({ message: 'Invalid bets payload' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const user = userRes.rows[0];
    const totalStake = items.reduce((sum, item) => sum + Number(item.stake), 0);
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }
    if (Number(user.balance) < totalStake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // FIX (N+1 + deadlock): lock every referenced match in ONE round trip,
    // always sorted by id. Two tickets that share matches in a different
    // order can no longer deadlock against each other, and we no longer
    // issue a separate SELECT ... FOR UPDATE per item in a loop.
    const matchIds = [...new Set(items.map((item) => Number(item.match_id)))].sort((a, b) => a - b);
    const matchesRes = await client.query(
      'SELECT id, status, kickoff_time FROM matches WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
      [matchIds]
    );
    const matchById = new Map(matchesRes.rows.map((row) => [Number(row.id), row]));

    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = ANY($1::int[])', [matchIds]);
    const oddsByMatchId = new Map(oddsRes.rows.map((row) => [Number(row.match_id), row]));

    const createdBets = [];
    for (const item of items) {
      const match = matchById.get(Number(item.match_id));
      if (!match || match.status !== 'OPEN' || new Date(match.kickoff_time).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Betting is closed for one of the selected matches' });
      }

      const odds = oddsByMatchId.get(Number(item.match_id));
      if (!odds) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Odds not found for one of the selected matches' });
      }

      const oddsBySelection = {
        HOME: odds.odds_home,
        AWAY: odds.odds_away,
        OVER: odds.odds_over,
        UNDER: odds.odds_under,
      };

      const oddsRate = Number(oddsBySelection[item.bet_selection]);
      if (!Number.isFinite(oddsRate) || oddsRate < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid odds for one of the selected bets' });
      }

      const betRes = await client.query(
        `INSERT INTO bets (user_id, match_id, bet_type, bet_selection, stake, odds_rate)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, item.match_id, item.bet_type, item.bet_selection, Number(item.stake), oddsRate]
      );
      createdBets.push(betRes.rows[0]);
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [totalStake, userId]);
    const balanceRes = await client.query('SELECT balance FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    socketService.emitSafe('bets:updated', { userId });
    res.status(201).json({
      message: 'Bets placed successfully',
      bets: createdBets,
      balance: balanceRes.rows[0].balance,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.placeTicket = async (req, res) => {
  const userId = req.user.id;
  const { stake, multiplier, items } = req.body;
  const numericStake = Number(stake);
  const numericMultiplier = Number(multiplier);
  if (!Number.isFinite(numericStake) || numericStake <= 0 || !Number.isFinite(numericMultiplier)
    || numericMultiplier <= 0 || !Array.isArray(items) || items.length < 3 || items.length > 5) {
    return res.status(400).json({ message: 'Invalid parlay ticket' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }
    if (Number(user.balance) < numericStake) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Same fix as placeBetsBatch: one sorted, batched lock instead of N
    // sequential SELECT ... FOR UPDATE calls inside a loop.
    const matchIds = [...new Set(items.map((item) => Number(item.match_id)))].sort((a, b) => a - b);
    const matchesRes = await client.query(
      'SELECT id, status, kickoff_time FROM matches WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
      [matchIds]
    );
    const matchById = new Map(matchesRes.rows.map((row) => [Number(row.id), row]));
    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = ANY($1::int[])', [matchIds]);
    const oddsByMatchId = new Map(oddsRes.rows.map((row) => [Number(row.match_id), row]));

    // Validate everything up front so we never leave a half-created ticket
    // if a later item in the list turns out to be invalid.
    for (const item of items) {
      const match = matchById.get(Number(item.match_id));
      if (!match || match.status !== 'OPEN' || new Date(match.kickoff_time).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Betting is closed for one of the selected matches' });
      }
      const odds = oddsByMatchId.get(Number(item.match_id));
      const oddsRate = odds && {
        HOME: odds.odds_home, AWAY: odds.odds_away, OVER: odds.odds_over, UNDER: odds.odds_under,
      }[item.bet_selection];
      if (!odds || !['HOME', 'AWAY', 'OVER', 'UNDER'].includes(item.bet_selection)
        || !Number.isFinite(Number(oddsRate))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid parlay selection' });
      }
    }

    const ticket = (await client.query(
      `INSERT INTO bet_tickets (user_id, stake, multiplier)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, numericStake, numericMultiplier]
    )).rows[0];

    for (const item of items) {
      const odds = oddsByMatchId.get(Number(item.match_id));
      const oddsRate = {
        HOME: odds.odds_home, AWAY: odds.odds_away, OVER: odds.odds_over, UNDER: odds.odds_under,
      }[item.bet_selection];
      await client.query(
        `INSERT INTO bet_ticket_items (ticket_id, match_id, bet_type, bet_selection, odds_rate)
         VALUES ($1, $2, $3, $4, $5)`,
        [ticket.id, item.match_id, item.bet_type, item.bet_selection, oddsRate]
      );
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [numericStake, userId]);
    const balance = (await client.query('SELECT balance FROM users WHERE id = $1', [userId])).rows[0].balance;
    await client.query('COMMIT');
    socketService.emitSafe('bets:updated', { userId });
    res.status(201).json({ message: 'Parlay ticket placed successfully', ticket, balance });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ดูประวัติการแทงของตัวเอง
// FIX: added pagination (page/limit) so this stops getting slower forever
// as a user accumulates bets. Defaults keep old callers working unchanged.
exports.getMyBets = async (req, res) => {
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const query = `
      SELECT b.*, m.home_team, m.away_team, m.home_score, m.away_score, m.status AS match_status
      FROM bets b
      JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await db.query(query, [userId, limit, offset]);
    const tickets = await db.query(
      `SELECT t.*, json_agg(json_build_object(
        'match_id', i.match_id, 'bet_type', i.bet_type, 'bet_selection', i.bet_selection,
        'odds_rate', i.odds_rate, 'result', i.result, 'home_team', m.home_team, 'away_team', m.away_team,
        'home_score', m.home_score, 'away_score', m.away_score
      ) ORDER BY i.id) AS items
       FROM bet_tickets t
       JOIN bet_ticket_items i ON i.ticket_id = t.id
       JOIN matches m ON m.id = i.match_id
       WHERE t.user_id = $1
       GROUP BY t.id ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    res.json([
      ...result.rows,
      ...tickets.rows.map((ticket) => ({
        ...ticket,
        is_ticket: true,
        match_id: null,
        stake: ticket.stake,
        status: ticket.status,
        payout: ticket.payout
      }))
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.cancelBet = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const bet = (await client.query(
      `SELECT b.*, m.kickoff_time FROM bets b
       JOIN matches m ON m.id = b.match_id
       WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE`,
      [req.params.betId, req.user.id]
    )).rows[0];
    if (!bet || bet.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Bet not found or already settled' });
    }
    if (new Date(bet.kickoff_time).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Bet can no longer be cancelled' });
    }
    const refund = Math.floor(Number(bet.stake) * 0.9);
    await client.query('DELETE FROM bets WHERE id = $1', [bet.id]);
    const balance = (await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [refund, req.user.id]
    )).rows[0].balance;
    await client.query('COMMIT');
    socketService.emitSafe('bets:updated', { userId: req.user.id });
    res.json({ message: 'Bet cancelled', refund, balance });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
