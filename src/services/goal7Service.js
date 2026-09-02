const { chromium } = require('playwright');
const db = require('../config/db');

const GOAL7_URL = 'https://goal7.co/';

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

function findGoal7ResultForMatch(rowText, homeTeam, awayTeam) {
  const homeKey = normalizeTeamName(homeTeam);
  const awayKey = normalizeTeamName(awayTeam);

  if (!homeKey || !awayKey) return null;

  const rowNormalized = normalizeTeamName(rowText);
  if (!rowNormalized.includes(homeKey) || !rowNormalized.includes(awayKey)) {
    return null;
  }

  return extractScoreFromRow(rowText);
}

async function syncOpenMatchesFromGoal7() {
  const result = await db.query(
    "SELECT id, home_team, away_team, status FROM matches WHERE status IN ('OPEN', 'SCHEDULED', 'PENDING') ORDER BY kickoff_time ASC"
  );

  if (!result.rows.length) {
    return { updated: 0, matches: [] };
  }

  const pageText = await fetchGoal7PageText();
  const goal7Rows = extractGoal7Rows(pageText);
  const syncedMatches = [];

  for (const match of result.rows) {
    const foundRow = goal7Rows.find((row) => {
      return !!findGoal7ResultForMatch(row, match.home_team, match.away_team);
    });

    if (!foundRow) continue;

    const score = findGoal7ResultForMatch(foundRow, match.home_team, match.away_team);
    if (!score) continue;

    syncedMatches.push({
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: score.home_score,
      away_score: score.away_score,
    });
  }

  return { updated: syncedMatches.length, matches: syncedMatches };
}

module.exports = {
  fetchGoal7PageText,
  syncOpenMatchesFromGoal7,
  findGoal7ResultForMatch,
  extractGoal7Rows,
  extractScoreFromRow,
  normalizeTeamName,
};
