const { chromium } = require('playwright');
const db = require('../config/db');

const GOAL7_URL = 'https://goal7.co/';
const KICKOFF_TOLERANCE_MINUTES = 180; // ±3 hours — guards against matching an unrelated same-day fixture

function normalizeTeamName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractGoal7Rows(text = '') {
  const sourceRows = Array.isArray(text)
    ? text
    : text.match(/\d{1,2}:\d{2}[^\n]{0,500}/g) || [];
  const rawRows = sourceRows.filter((row) => {
    return row.toUpperCase().includes('FT') && /\d+\s*-\s*\d+/.test(row) && !/\?\s*-\s*\?/.test(row);
  });

  const uniqueRows = [];
  const seen = new Set();
  for (const row of rawRows) {
    if (!seen.has(row)) {
      seen.add(row);
      uniqueRows.push(row);
    }
  }

  return uniqueRows;
}

function extractRowTime(row = '') {
  const match = row.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function extractScoreFromRow(row = '') {
  const scoreMatches = [...row.matchAll(/(\d+)\s*-\s*(\d+)/g)];
  const scoreMatch = scoreMatches[scoreMatches.length - 1];
  if (!scoreMatch) return null;

  return {
    home_score: Number(scoreMatch[1]),
    away_score: Number(scoreMatch[2]),
  };
}

async function fetchGoal7PageText() {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    await page.goto(GOAL7_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const rows = await page.evaluate(() => {
      if (!globalThis.document) return [];
      return Array.from(globalThis.document.querySelectorAll('tr.utable_tr')).map((row) =>
        row.innerText.replace(/\s+/g, ' ').trim()
      );
    });

    return rows;
  } finally {
    await browser.close();
  }
}

// FIX: the previous version only checked that both team names appeared
// SOMEWHERE in the row, with no check on order and no check on time. That
// allowed two silent bugs:
//   1. Score swap — the two score numbers were assigned home-first,
//      away-second purely by position in the text. If goal7 displays the
//      fixture as "away vs home" for some leagues, home_score and
//      away_score ended up swapped even though both team names matched.
//   2. Wrong-fixture match — if another same-day row happened to contain
//      both team names too (reserve/youth fixture, similarly named club,
//      etc.), the first matching row silently won with no time check.
// This version verifies which team name appears first in the row (to
// correct for reversed order) and, when we know the kickoff time, only
// accepts rows whose displayed time is close to it.
function findGoal7ResultForMatch(rowText, homeTeam, awayTeam, kickoffTime) {
  const homeKey = normalizeTeamName(homeTeam);
  const awayKey = normalizeTeamName(awayTeam);
  if (!homeKey || !awayKey) return null;

  const rowNormalized = normalizeTeamName(rowText);
  const homeIdx = rowNormalized.indexOf(homeKey);
  const awayIdx = rowNormalized.indexOf(awayKey);
  if (homeIdx === -1 || awayIdx === -1) return null;

  const score = extractScoreFromRow(rowText);
  if (!score) return null;

  if (kickoffTime) {
    const rowTime = extractRowTime(rowText);
    if (rowTime) {
      const kickoff = new Date(kickoffTime);
      const rowMinutes = rowTime.hour * 60 + rowTime.minute;
      const kickoffMinutes = kickoff.getHours() * 60 + kickoff.getMinutes();
      const rawDiff = Math.abs(rowMinutes - kickoffMinutes);
      const diff = Math.min(rawDiff, 1440 - rawDiff); // wrap around midnight
      if (diff > KICKOFF_TOLERANCE_MINUTES) return null;
    }
  }

  // If the away team's name appears before the home team's name in the
  // row, goal7 listed this fixture in the opposite order to ours — the
  // score numbers are therefore swapped relative to our home/away.
  const isReversedOrder = awayIdx < homeIdx;
  return isReversedOrder
    ? { home_score: score.away_score, away_score: score.home_score }
    : score;
}

async function syncOpenMatchesFromGoal7() {
  const result = await db.query(
    "SELECT id, home_team, away_team, kickoff_time, status FROM matches WHERE status IN ('OPEN', 'SCHEDULED', 'PENDING') ORDER BY kickoff_time ASC"
  );

  if (!result.rows.length) {
    return { updated: 0, matches: [] };
  }

  const pageText = await fetchGoal7PageText();
  const goal7Rows = extractGoal7Rows(pageText);
  const syncedMatches = [];
  const ambiguousMatches = [];

  for (const match of result.rows) {
    const candidateRows = goal7Rows.filter((row) =>
      !!findGoal7ResultForMatch(row, match.home_team, match.away_team, match.kickoff_time)
    );

    if (!candidateRows.length) continue;

    if (candidateRows.length > 1) {
      // More than one row plausibly matches -- don't guess which one is
      // right. Flag it so an admin can settle this match manually instead
      // of risking a wrong score going in automatically.
      ambiguousMatches.push({
        match_id: match.id,
        home_team: match.home_team,
        away_team: match.away_team,
        candidateCount: candidateRows.length,
      });
      continue;
    }

    const score = findGoal7ResultForMatch(candidateRows[0], match.home_team, match.away_team, match.kickoff_time);
    if (!score) continue;

    syncedMatches.push({
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: score.home_score,
      away_score: score.away_score,
    });
  }

  if (ambiguousMatches.length) {
    console.warn('[goal7Service] Ambiguous match(es) skipped, needs manual settle:', ambiguousMatches);
  }

  return { updated: syncedMatches.length, matches: syncedMatches, ambiguous: ambiguousMatches };
}

module.exports = {
  fetchGoal7PageText,
  syncOpenMatchesFromGoal7,
  findGoal7ResultForMatch,
  extractGoal7Rows,
  extractScoreFromRow,
  normalizeTeamName,
};
