// Tactical AI behaviour against concrete robot-sumo situations and scripted opponents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSimulation } from './game.js';
import { applyMatchLearning, createDefaultAI, TACTICS } from './data.js';
import { OPPONENT_TYPES, playMatch, seededRandom } from './opponents.js';

const headless = (seed = 1) => {
  const sim = BattleSimulation.createHeadless(createDefaultAI(), { random: seededRandom(seed) });
  sim.countdown = 0; sim.time = 1; return sim;
};
const place = (unit, x, y, angle) => Object.assign(unit, { x, y, angle, vx: 0, vy: 0, omega: 0 });

test('pushed hard from the side, the AI switches to the side-push response instead of shoving forward', () => {
  const sim = headless(3);
  place(sim.ai, 0, 0, 0);                     // AI faces +x
  place(sim.player, 0, 52, -Math.PI / 2);     // player's blade on the AI's right side
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0.9; sim.tacticLockUntil = 0;
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) { sim.setInput('left', 1); sim.setInput('right', 1); sim.step(1 / 120); seen.add(sim.tacticId); }
  assert.equal(sim.tacticId, 'pivot', `expected pivot under side pressure, saw ${[...seen].join(',')}`);
  assert.ok(sim.lastSituation.sidePressure > 0.22, 'side pressure must be detected');
  // While pivoting it must not command a straight full-power shove.
  const control = sim.controlForTactic();
  assert.ok(Math.abs(control.left - control.right) > 0.3, 'the response rotates/slides instead of pushing straight');
});

test('direct attack is strongly penalised while the side is under pressure', () => {
  const sim = headless(4);
  place(sim.ai, 0, 0, 0); place(sim.player, 0, 52, -Math.PI / 2);
  for (let i = 0; i < 30; i += 1) { sim.setInput('left', 1); sim.setInput('right', 1); sim.step(1 / 120); }
  sim.selectTactic(false);
  const direct = sim.lastScores.find((entry) => entry.id === 'direct');
  assert.ok(!direct || direct.score < sim.lastScores[0].score - 2, 'direct must not be a top candidate when side-pushed');
});

test('a blade-to-blade shove is NOT mistaken for a side push', () => {
  const sim = headless(5);
  place(sim.ai, 29.4, 0, Math.PI); place(sim.player, -29.4, 0, 0.25); // slightly angled head-on
  for (let i = 0; i < 60; i += 1) { sim.setInput('left', 1); sim.setInput('right', 1); sim.step(1 / 120); }
  assert.ok(sim.lastSituation.sidePressure < 0.22, `frontal contact flagged as side push (${sim.lastSituation.sidePressure.toFixed(2)})`);
  assert.notEqual(sim.tacticId, 'pivot');
});

test('losing a head-on shove to a stronger opponent triggers a disengage (sidestep) rather than more shoving', () => {
  const sim = headless(6);
  place(sim.ai, 29.4, 0, Math.PI); place(sim.player, -29.4, 0, 0); sim.player.drivePower = 1.5;
  // Start inside an established shove: 'direct' is held until the contest is measured.
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0.5; sim.aiDecisionTimer = 0.4;
  const seen = new Set();
  for (let i = 0; i < 150 && !sim.ended; i += 1) { sim.setInput('left', 1); sim.setInput('right', 1); sim.step(1 / 120); seen.add(sim.tacticId); }
  assert.ok(seen.has('sidestep'), `expected sidestep when out-pushed, saw ${[...seen].join(',')}`);
});

test('reposition really backs off at close range (no forced forward override)', () => {
  const sim = headless(7);
  place(sim.ai, 40, 0, Math.PI); place(sim.player, -30, 0, 0);
  sim.tacticId = 'reposition'; sim.tacticStartedAt = 0.9;
  const control = sim.controlForTactic();
  assert.ok(control.left + control.right < 0, `reposition should reverse, got ${control.left.toFixed(2)}, ${control.right.toFixed(2)}`);
});

test('every tactic produces its own wheel command in the same situation (no renamed duplicates)', () => {
  const outputs = new Map();
  for (const def of TACTICS) {
    const sim = headless(8);
    place(sim.ai, 60, 30, Math.PI * 0.9); place(sim.player, -60, -10, 0.3);
    sim.player.vx = 20; sim.player.omega = 0.4;
    sim.tacticId = def.id; sim.tacticStartedAt = 0.6; sim.time = 1;
    if (def.id === 'pivot') { sim.pressure.side = 0.6; sim.lastSituation = { ...sim.assessSituation(), sidePressure: 0.6, touching: true, contactLocal: { x: 5, y: 23 } }; }
    if (def.id === 'sidestep') { sim.lastSituation = { ...sim.assessSituation(), frontalLoss: 20 }; }
    const c = sim.controlForTactic();
    outputs.set(def.id, `${c.left.toFixed(2)},${c.right.toFixed(2)}`);
  }
  const distinct = new Set(outputs.values());
  assert.ok(distinct.size >= TACTICS.length - 1, `tactics should behave differently: ${JSON.stringify(Object.fromEntries(outputs))}`);
});

test('the AI reads the situation: position, heading, speed, contact, edge margin, prediction', () => {
  const sim = headless(9);
  place(sim.ai, 100, 0, Math.PI); place(sim.player, -50, 20, 0.2); sim.player.vx = 40;
  const s = sim.assessSituation();
  for (const key of ['distance', 'bearing', 'opponentBearing', 'selfLong', 'selfSlip', 'selfOmega', 'opponentSpeed', 'closingSpeed', 'touching', 'selfMargin', 'opponentMargin', 'selfCenter', 'selfOutward', 'sidePressure', 'frontalLoss', 'predicted']) assert.ok(key in s, `situation lacks ${key}`);
  assert.ok(s.predicted.x > sim.player.x, 'prediction leads a moving opponent');
});

test('learned opening habits of the opponent shape the opening read', () => {
  const ai = createDefaultAI(); ai.opponentModel.openings = { retreat: 7, charge: 1 };
  const sim = BattleSimulation.createHeadless(ai, { random: seededRandom(10) });
  assert.ok(sim.opening.likelyOpponentResponses.includes('retreat'));
  assert.ok(sim.opening.opponentOpeningProbs.retreat > 0.5);
});

test('scripted opponents: the AI beats turning, irregular and retreating opponents and is not helpless against charging ones', () => {
  const summary = {};
  for (const [index, type] of ['direct', 'retreat', 'turn', 'random', 'counter', 'strong'].entries()) {
    const results = Array.from({ length: 8 }, (_, i) => playMatch(createDefaultAI(), type, 4242 + index * 1000 + i * 97));
    summary[type] = { wins: results.filter((r) => r.winner === 'ai').length, aiOut: results.filter((r) => r.aiOut).length };
  }
  for (const type of ['retreat', 'turn', 'random']) assert.ok(summary[type].wins >= 6, `${type}: ${JSON.stringify(summary[type])}`);
  assert.ok(summary.direct.wins >= 1, `direct: ${JSON.stringify(summary.direct)}`);
  assert.ok(summary.strong.wins >= 1, `a 25% stronger charger must still be beatable: ${JSON.stringify(summary.strong)}`);
  const total = Object.values(summary).reduce((sum, row) => sum + row.wins, 0);
  assert.ok(total >= 24, `overall wins ${total}/48: ${JSON.stringify(summary)}`);
});

test('learning over a mixed schedule does not make the AI clearly worse on unseen seeds', () => {
  const types = Object.keys(OPPONENT_TYPES);
  const trained = createDefaultAI();
  for (let i = 0; i < 42; i += 1) applyMatchLearning(trained, playMatch(trained, types[i % types.length], 9100 + i * 13));
  const snapshot = JSON.stringify(trained);
  const score = (make) => types.reduce((sum, type, t) => sum + Array.from({ length: 4 }, (_, i) => playMatch(make(), type, 31000 + t * 500 + i * 71)).filter((r) => r.winner === 'ai').length, 0);
  const fresh = score(createDefaultAI); const learned = score(() => JSON.parse(snapshot));
  assert.ok(learned >= fresh - 4, `learned ${learned} vs fresh ${fresh} of ${types.length * 4}`);
  assert.equal(trained.matches, 42);
  assert.ok(trained.opponentModel.matches === 42 && Object.keys(trained.opponentModel.styles).length > 0);
});
