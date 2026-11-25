#!/usr/bin/env node
// Same opponents and seeds against a legacy (third-improvement) build.
//   node scripts/compare-legacy.mjs <path-to-legacy-src> [matchesPerType]
// The legacy physics used the mirrored wheel convention (right-faster turned
// clockwise), so opponent wheel commands are swapped to keep the same intent.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { OPPONENT_TYPES, createOpponent, seededRandom } from '../src/opponents.js';

const legacyDir = resolve(process.argv[2] || '');
const perType = Number(process.argv[3] || 30);
const { BattleSimulation } = await import(pathToFileURL(`${legacyDir}/game.js`).href);
const { createDefaultAI } = await import(pathToFileURL(`${legacyDir}/data.js`).href);
const unit = (x, y, angle, power = 1) => ({ x, y, angle, vx: 0, vy: 0, omega: 0, left: 0, right: 0, drivePower: power, mass: 1, inertia: 330, trail: [] });

function match(type, seed) {
  const random = seededRandom(seed); const prior = Math.random; Math.random = random;
  try {
    let result = null; const sim = Object.create(BattleSimulation.prototype);
    Object.assign(sim, { canvas: null, aiState: createDefaultAI(), onFinish: (o) => { result = o; }, running: true, ended: false, frame: 0, time: 0, countdown: 0, aiDecisionTimer: 0,
      tacticId: '', tacticStartedAt: 0, tacticLockUntil: 0, flankSide: random() > 0.5 ? 1 : -1, usedTactics: new Set(), tacticHistory: [], tacticUsage: {}, input: { left: 0, right: 0 } });
    sim.player = unit(-112, 0, 0, OPPONENT_TYPES[type].drivePower); sim.ai = unit(112, 0, Math.PI);
    sim.opening = sim.analyzeOpening(); sim.draw = () => {};
    const opponent = createOpponent(type, seededRandom(seed ^ 0x9e3779b9)); const dt = 1 / 120;
    for (let i = 0; i < 58.5 / dt && !result; i += 1) {
      const c = opponent(sim, sim.time); sim.input = { left: c.right, right: c.left };
      sim.time += dt; sim.update(dt);
    }
    return result || { winner: 'draw', aiOut: false, playerOut: false, time: sim.time };
  } finally { Math.random = prior; }
}

console.log(`| 相手 | 旧版 AI勝/敗/分 | 勝率 | 相手場外 | AI場外 | 平均時間 |`);
console.log('|---|---:|---:|---:|---:|---:|');
for (const [index, type] of Object.keys(OPPONENT_TYPES).entries()) {
  const rs = Array.from({ length: perType }, (_, i) => match(type, 20261126 + index * 1000 + i * 97));
  const n = rs.length; const p = (k) => `${((k / n) * 100).toFixed(1)}%`;
  console.log(`| ${OPPONENT_TYPES[type].label} | ${rs.filter((r) => r.winner === 'ai').length}/${rs.filter((r) => r.winner === 'player').length}/${rs.filter((r) => r.winner === 'draw').length} | ${p(rs.filter((r) => r.winner === 'ai').length)} | ${p(rs.filter((r) => r.playerOut && !r.aiOut).length)} | ${p(rs.filter((r) => r.aiOut).length)} | ${(rs.reduce((s, r) => s + r.time, 0) / n).toFixed(1)}s |`);
}
