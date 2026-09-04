const db = require('../config/db');
const { syncOpenMatchesFromGoal7 } = require('../services/goal7Service');

async function settleMatchById(matchId, home_score, away_score, providedClient) {
  const client = providedClient || (await db.pool.connect());
  const shouldRelease = !providedClient;

  try {
    if (shouldRelease) await client.query('BEGIN');

    const matchUpdate = await client.query(
      `UPDATE matches
       SET home_score = $1, away_score = $2, status = 'FINISHED'
       WHERE id = $3 AND status <> 'FINISHED'
       RETURNING id`,
      [home_score, away_score, matchId]
    );

    if (!matchUpdate.rowCount) {
      if (shouldRelease) await client.query('COMMIT');
      return { processed: 0, scores: { home_score, away_score }, matchId, skipped: true };
    }

    const oddsRes = await client.query('SELECT * FROM odds WHERE match_id = $1', [matchId]);
    const odds = oddsRes.rows[0];

    if (!odds) {
      if (shouldRelease) await client.query('COMMIT');
      return { processed: 0, scores: { home_score, away_score }, matchId };
    }

    const betsRes = await client.query(
      `SELECT * FROM bets WHERE match_id = $1 AND status = 'PENDING'`,
      [matchId]
    );
    const bets = betsRes.rows;

    const totalHome = Number(home_score) + Number(odds.hdp_home);
    const totalAway = Number(away_score) + Number(odds.hdp_away);
    const totalGoals = Number(home_score) + Number(away_score);

    for (const bet of bets) {
      let isWin = false;
      let payout = 0;
      const stake = parseFloat(bet.stake);
      const rate = parseFloat(bet.odds_rate);

      if (bet.bet_type === 'HDP') {
       if (bet.bet_selection === 'HOME' && totalHome > totalAway) isWin = true;
       if (bet.bet_selection === 'AWAY' && totalAway > totalHome) isWin = true;
      } else if (bet.bet_type === 'OU') {
       if (bet.bet_selection === 'OVER' && totalGoals > Number(odds.over_under)) isWin = true;
       if (bet.bet_selection === 'UNDER' && totalGoals < Number(odds.over_under)) isWin = true;
      }

      if (isWin) {
       // FIX: was `stake + (stake * rate)`. That formula treats `rate` as a
       // *profit ratio* on top of the stake -- so a rate of 0.9 paid out
       // 1.9x. Parlay tickets already use the correct convention
       // (`stake * multiplier` a few lines down / in the ticket branch
       // below), where the rate/multiplier IS the full return including
       // principal (e.g. 1.8 means "get back 1.8x your stake total").
       // Single/HDP-OU bets now match that same convention.
       payout = stake * rate;

       await client.query(
         `UPDATE bets SET status = 'WIN', payout = $1 WHERE id = $2`,
         [payout, bet.id]
       );

       await client.query(
         `UPDATE users SET balance = balance + $1 WHERE id = $2`,
         [payout, bet.user_id]
       );
      } else {
       await client.query(
         `UPDATE bets SET status = 'LOSS', payout = 0 WHERE id = $1`,
         [bet.id]
       );
      }
    }

    const ticketItems = await client.query(
      `SELECT i.*, t.user_id, t.stake, t.multiplier, t.status AS ticket_status
       FROM bet_ticket_items i
       JOIN bet_tickets t ON t.id = i.ticket_id
       WHERE i.match_id = $1 AND i.result = 'PENDING'`,
      [matchId]
    );
    for (const item of ticketItems.rows) {
      let result = 'LOSS';
      if (item.bet_type === 'HDP') {
        const adjusted = item.bet_selection === 'HOME' ? totalHome - totalAway : totalAway - totalHome;
        result = adjusted > 0 ? 'WIN' : adjusted === 0 ? 'PUSH' : 'LOSS';
      } else if (item.bet_type === 'OU') {
        const adjusted = item.bet_selection === 'OVER'
          ? totalGoals - Number(odds.over_under)
          : Number(odds.over_under) - totalGoals;
        result = adjusted > 0 ? 'WIN' : adjusted === 0 ? 'PUSH' : 'LOSS';
      }
      await client.query('UPDATE bet_ticket_items SET result = $1 WHERE id = $2', [result, item.id]);
      const remaining = await client.query(
        `SELECT result FROM bet_ticket_items WHERE ticket_id = $1`,
        [item.ticket_id]
      );
      if (remaining.rows.some((row) => row.result === 'PENDING')) continue;
      const ticket = await client.query(
        'SELECT * FROM bet_tickets WHERE id = $1 FOR UPDATE',
        [item.ticket_id]
      );
      if (!ticket.rows.length || ticket.rows[0].status !== 'PENDING') continue;
      const hasLoss = remaining.rows.some((row) => row.result === 'LOSS');
      const payout = hasLoss ? 0 : Number(ticket.rows[0].stake) * Number(ticket.rows[0].multiplier);
      await client.query(
        'UPDATE bet_tickets SET status = $1, payout = $2 WHERE id = $3',
        [hasLoss ? 'LOSS' : 'WIN', payout, item.ticket_id]
      );
      if (payout > 0) {
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, item.user_id]);
      }
    }

    if (shouldRelease) await client.query('COMMIT');

    return {
      processed: bets.length,
      scores: { home_score, away_score },
      matchId,
    };
  } catch (err) {
    if (shouldRelease) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}

// [ADMIN] กรอกผลสกอร์และคำนวณผลการเดิมพันทั้งหมด
exports.settleMatch = async (req, res) => {
  const { matchId } = req.params;
  const { home_score, away_score } = req.body;

  try {
    const result = await settleMatchById(Number(matchId), Number(home_score), Number(away_score));
    res.json({
      message: `Match settled successfully. Processed ${result.processed} bets.`,
      scores: result.scores,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.syncGoal7Results = async (req, res) => {
  try {
    const result = await autoSettleGoal7Results();

    res.json({
      ok: true,
      synced: result.synced,
      message: result.synced
       ? `Auto-settled ${result.synced} matches from goal7.co`
       : 'No finished result found on goal7.co yet.',
      matches: result.matches,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

async function autoSettleGoal7Results() {
  const snapshot = await syncOpenMatchesFromGoal7();
  if (!snapshot.matches.length) return { synced: 0, matches: [] };

  const client = await db.pool.connect();
  const settledMatches = [];

  try {
    await client.query('BEGIN');
    for (const match of snapshot.matches) {
      const result = await settleMatchById(
        match.match_id,
        match.home_score,
        match.away_score,
        client
      );
      if (!result.skipped) {
        settledMatches.push({ ...match, processed: result.processed });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { synced: settledMatches.length, matches: settledMatches };
}

exports.autoSettleGoal7Results = autoSettleGoal7Results;
exports.settleMatchById = settleMatchById;
