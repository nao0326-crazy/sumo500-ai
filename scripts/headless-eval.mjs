#!/usr/bin/env node
// Headless evaluation of the AI against scripted opponents.
//   node scripts/headless-eval.mjs [matchesPerType=30] [--json out.json] [--learning]
// - "fresh": the default AI (no learning) on identical seeds per opponent type.
// - "--learning": trains one AI over a mixed schedule, then compares the trained AI
//   with the fresh AI on held-out seeds to detect learning that makes the AI worse.
import { writeFileSync } from 'node:fs';
import { createDefaultAI, applyMatchLearning } from '../src/data.js';
import { OPPONENT_TYPES, playMatch } from '../src/opponents.js';

const args = process.argv.slice(2);
const perType = Number(args.find((a) => /^\d+$/.test(a)) || 30);
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const withLearning = args.includes('--learning');
const types = Object.keys(OPPONENT_TYPES);

function evaluate(makeAI, seedBase) {
  const rows = {};
  for (const [index, type] of types.entries()) {
    const results = [];
    for (let i = 0; i < perType; i += 1) results.push(playMatch(makeAI(), type, seedBase + index * 1000 + i * 97));
    const n = results.length; const pct = (k) => Number(((k / n) * 100).toFixed(1));
    const used = {}; let pivotTried = 0; let pivotOk = 0; let sideHit = 0; let sidePressure = 0;
    for (const r of results) {
      for (const u of r.tacticUsage) { used[u.tacticId] = (used[u.tacticId] || 0) + 1; if (u.tacticId === 'pivot' && typeof u.objective === 'boolean') { pivotTried += 1; if (u.objective) pivotOk += 1; } }
      sideHit += r.events.sideHitSeconds; sidePressure += r.events.sidePressureSeconds;
    }
    rows[type] = {
      label: OPPONENT_TYPES[type].label, matches: n,
      aiWins: results.filter((r) => r.winner === 'ai').length, aiLosses: results.filter((r) => r.winner === 'player').length, draws: results.filter((r) => r.winner === 'draw').length,
      winRate: pct(results.filter((r) => r.winner === 'ai').length),
      opponentRingOut: pct(results.filter((r) => r.playerOut && !r.aiOut).length), aiRingOut: pct(results.filter((r) => r.aiOut).length),
      avgTime: Number((results.reduce((s, r) => s + r.time, 0) / n).toFixed(1)),
      sideHitSecondsPerMatch: Number((sideHit / n).toFixed(2)), sidePressureSecondsPerMatch: Number((sidePressure / n).toFixed(2)),
      pivot: { attempts: pivotTried, recoveries: pivotOk }, tacticsUsed: used
    };
  }
  return rows;
}

function printTable(title, rows) {
  console.log(`\n## ${title}`);
  console.log('| 相手 | AI勝/敗/分 | 勝率 | 相手場外 | AI場外 | 平均時間 | 側面取得s/戦 | 横押され s/戦 | 向き直り成功 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of Object.values(rows)) console.log(`| ${row.label} | ${row.aiWins}/${row.aiLosses}/${row.draws} | ${row.winRate}% | ${row.opponentRingOut}% | ${row.aiRingOut}% | ${row.avgTime}s | ${row.sideHitSecondsPerMatch} | ${row.sidePressureSecondsPerMatch} | ${row.pivot.recoveries}/${row.pivot.attempts} |`);
}

const report = { generatedAt: new Date().toISOString(), perType, fresh: evaluate(createDefaultAI, 20261126) };
printTable(`初期AI（学習なし） 各${perType}試合`, report.fresh);

if (withLearning) {
  const trained = createDefaultAI();
  const schedule = 120;
  for (let i = 0; i < schedule; i += 1) {
    const type = types[i % types.length];
    const outcome = playMatch(trained, type, 5150000 + i * 31);
    applyMatchLearning(trained, outcome);
  }
  const snapshot = JSON.stringify(trained);
  report.trainedMatches = schedule;
  report.trained = evaluate(() => JSON.parse(snapshot), 77700000);
  report.freshHeldOut = evaluate(createDefaultAI, 77700000);
  report.trainedPriorities = Object.fromEntries(Object.entries(trained.tactics).map(([id, s]) => [id, Number(s.priority.toFixed(3))]));
  printTable(`初期AI（検証用の別seed）`, report.freshHeldOut);
  printTable(`学習後AI（${schedule}試合学習・同じ検証seed）`, report.trained);
  console.log('\n学習後の優先度:', report.trainedPriorities);
}

if (jsonPath) { writeFileSync(jsonPath, JSON.stringify(report, null, 2)); console.log(`\nJSON: ${jsonPath}`); }
