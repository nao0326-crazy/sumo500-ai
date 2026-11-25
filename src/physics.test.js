import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSimulation, contactManifold, FOOTPRINT, ROBOT_RADIUS } from './game.js';
import { createDefaultAI, DATA_VERSION, loadAI, matchWinRate, recordEscapeOutcome, recordMatchResult, recordOutcome, recordTacticExecutions, recordTacticSelection, saveAI, successRate, TACTICS } from './data.js';

function unit(x, y, angle, { left = 0, right = 0, power = 1 } = {}) {
  return { x, y, angle, vx: 0, vy: 0, omega: 0, left, right, drivePower: power, mass: 1, inertia: 330, trail: [] };
}

function simulation(player, ai) {
  const sim = Object.create(BattleSimulation.prototype);
  sim.player = player; sim.ai = ai;
  return sim;
}

function tacticalSimulation({ ai = unit(0, 0, 0), player = unit(200, 0, 0), opening = { placement: 'mid', cornerAdvantage: false, bladeAdvantage: 0, space: 'usable' } } = {}) {
  const sim = simulation(player, ai);
  sim.aiState = createDefaultAI(); sim.opening = opening; sim.time = 1; sim.tacticId = ''; sim.tacticStartedAt = 0;
  sim.flankSide = 1; sim.usedTactics = new Set(); sim.tacticHistory = []; sim.tacticUsage = {};
  return sim;
}

function chooseWithFixedRandom(sim) {
  const prior = Math.random;
  Math.random = () => 0.99;
  try { sim.selectTactic(false); return sim.tacticId; }
  finally { Math.random = prior; }
}

function advance(sim, frames, controlA, controlB, dt = 1 / 120) {
  for (let i = 0; i < frames; i += 1) {
    Object.assign(sim.player, controlA); Object.assign(sim.ai, controlB);
    sim.applyDrive(sim.player, dt); sim.applyDrive(sim.ai, dt); sim.resolveRobotCollision(dt);
  }
}

test('collision shape includes blade and wide chassis instead of a center-distance circle', () => {
  // Updated for 100mm × 100mm square robot: footprint has 4 corners (vs old 10-sided polygon)
  assert.equal(FOOTPRINT.length, 4);
  const sim = simulation(unit(0, 0, 0), unit(0, 100, 0));
  assert.equal(sim.resolveRobotCollision(), false);
  assert.ok(ROBOT_RADIUS > 25);
});

test('player full-drive pushes a stationary AI straight ahead', () => {
  const p = unit(-29.4, 0, 0); const ai = unit(29.4, 0, 0); const sim = simulation(p, ai);
  advance(sim, 90, { left: 1, right: 1 }, { left: 0, right: 0 });
  assert.ok(ai.x > 55, `AI should be displaced by player drive; got ${ai.x.toFixed(1)}`);
  assert.ok(p.x < ai.x);
  const manifold = contactManifold(p, ai);
  assert.ok(!manifold || manifold.overlap < 1.5, 'robots must not remain deeply interpenetrating');
});

test('AI full-drive pushes a stationary player straight ahead', () => {
  const p = unit(-29.4, 0, 0); const ai = unit(29.4, 0, Math.PI); const sim = simulation(p, ai);
  advance(sim, 90, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(p.x < -55, `player should be displaced by AI drive; got ${p.x.toFixed(1)}`);
  assert.ok(ai.x > p.x);
  const manifold = contactManifold(p, ai);
  assert.ok(!manifold || manifold.overlap < 1.5);
});

test('AI direct tactic steers into contact and pushes a stationary player', () => {
  const p = unit(-29.4, 0, 0); const ai = unit(29.4, 0, Math.PI); const sim = simulation(p, ai);
  sim.aiState = createDefaultAI(); sim.tacticId = 'direct'; sim.tacticStartedAt = 0; sim.time = 1; sim.flankSide = 1;
  const dt = 1 / 120;
  for (let i = 0; i < 90; i += 1) {
    p.left = 0; p.right = 0; Object.assign(ai, sim.controlForTactic());
    sim.applyDrive(p, dt); sim.applyDrive(ai, dt); sim.resolveRobotCollision(dt);
  }
  assert.ok(p.x < -45, `AI's existing direct tactic must shove the player, got ${p.x.toFixed(1)}`);
});

test('head-on forward drives create a stable opposing force balance', () => {
  const p = unit(-29.4, 0, 0); const ai = unit(29.4, 0, Math.PI); const sim = simulation(p, ai);
  advance(sim, 120, { left: 1, right: 1 }, { left: 1, right: 1 });
  assert.ok(Math.abs(p.x + ai.x) < 4, `balanced robots should stay near the same center, got ${p.x.toFixed(1)}, ${ai.x.toFixed(1)}`);
  assert.ok(Math.abs(p.vx) < 2 && Math.abs(ai.vx) < 2, 'opposing equal drive should not build unbounded velocity');
  const manifold = contactManifold(p, ai);
  assert.ok(!manifold || manifold.overlap < 1.5, 'contact should not cause visible overlap or vibration');
});

test('a side attack translates and yaws the contacted robot', () => {
  const p = unit(0, 0, 0); const ai = unit(0, 51, -Math.PI / 2); const sim = simulation(p, ai);
  advance(sim, 60, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(p.y < -5 || Math.abs(p.omega) > 0.04, `side collision should shift or rotate player: y=${p.y}, omega=${p.omega}`);
  const manifold = contactManifold(p, ai);
  assert.ok(!manifold || manifold.overlap < 1.5);
});

test('diagonal contact transfers momentum and produces a turning moment', () => {
  const p = unit(0, 0, 0); const ai = unit(44, 25, Math.atan2(-25, -44)); const sim = simulation(p, ai);
  advance(sim, 55, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(Math.hypot(p.vx, p.vy) > 5 || Math.abs(p.omega) > 0.04, 'diagonal blade impact must move or yaw the opponent');
  assert.ok(Math.hypot(p.x - ai.x, p.y - ai.y) > 20);
});

test('stronger drive power pushes a lower-powered opponent', () => {
  const p = unit(-29.4, 0, 0, { power: 1.35 }); const ai = unit(29.4, 0, 0, { power: 0.55 }); const sim = simulation(p, ai);
  advance(sim, 75, { left: 1, right: 1 }, { left: 0.4, right: 0.4 });
  assert.ok(ai.x > 52, `higher motor force should move opponent, got ${ai.x.toFixed(1)}`);
  assert.ok(p.x < ai.x);
});

test('a forward push near the dohyo edge can drive the target out', () => {
  const p = unit(153, 0, 0); const ai = unit(212, 0, 0); const sim = simulation(p, ai);
  advance(sim, 135, { left: 1, right: 1 }, { left: 0, right: 0 });
  assert.ok(ai.x > 243, `AI should reach the ring-out threshold, got ${ai.x.toFixed(1)}`);
  assert.equal(sim.isOut(ai), true);
});

test('both robots can continue rotating while in sustained contact without overlap', () => {
  const p = unit(-29.4, 0, 0); const ai = unit(29.4, 0, Math.PI); const sim = simulation(p, ai);
  advance(sim, 90, { left: -0.35, right: 0.95 }, { left: 0.75, right: -0.25 });
  assert.ok(Math.abs(p.omega) > 0.1 && Math.abs(ai.omega) > 0.1, 'both differential drives should still turn while touching');
  const manifold = contactManifold(p, ai);
  assert.ok(!manifold || manifold.overlap < 2, `contact overlap should remain bounded, got ${manifold?.overlap}`);
});

test('existing zigzag and diagonal tactics still produce differential-wheel steering', () => {
  const sim = simulation(unit(0, 0, 0), unit(120, 60, Math.PI));
  sim.aiState = createDefaultAI(); sim.time = 0.8; sim.tacticStartedAt = 0; sim.flankSide = 1;
  for (const tacticId of ['zigzag', 'diagonal', 'doubleZigzag']) {
    sim.tacticId = tacticId;
    const controls = sim.controlForTactic();
    assert.ok(Number.isFinite(controls.left) && Number.isFinite(controls.right));
    assert.ok(Math.abs(controls.left - controls.right) > 0.02, `${tacticId} should retain its steering differential`);
  }
});

test('AI differential steering rotates toward positive and negative target errors', () => {
  // Canvas y points down, so a target at +y is to the robot's RIGHT (clockwise).
  // A real differential drive turns right by driving the LEFT wheel faster.
  // (Up to the third improvement this test asserted the mirrored convention.)
  for (const direction of [1, -1]) {
    const ai = unit(0, 0, 0); const sim = simulation(unit(-100, 0, 0), ai);
    const control = sim.steerTo({ x: 0, y: direction * 100 }, 0.8);
    assert.equal(Math.sign(control.left - control.right), direction, 'left-faster turns right (clockwise), right-faster turns left');
    for (let i = 0; i < 60; i += 1) { Object.assign(ai, control); sim.applyDrive(ai, 1 / 120); }
    assert.equal(Math.sign(ai.omega), direction, 'angular velocity should turn toward the target');
    const signedAngle = Math.atan2(Math.sin(ai.angle), Math.cos(ai.angle));
    assert.equal(Math.sign(signedAngle), direction, 'heading should rotate toward the target');
  }
});

test('tactic selection favors direct attack with a blade-angle advantage', () => {
  const sim = tacticalSimulation({ opening: { placement: 'corner', cornerAdvantage: true, bladeAdvantage: 0.7, space: 'usable' } });
  assert.equal(chooseWithFixedRandom(sim), 'direct');
});

test('tactic selection favors retreat-reading zigzag when the opponent backs away', () => {
  const player = unit(200, 0, Math.PI); player.vx = 55;
  const sim = tacticalSimulation({ player, opening: { placement: 'corner', cornerAdvantage: true, bladeAdvantage: 0.7, space: 'usable' } });
  assert.equal(chooseWithFixedRandom(sim), 'zigzag');
});

test('opening retreat prediction is connected to zigzag selection before opponent movement', () => {
  const sim = tacticalSimulation({ opening: { placement: 'corner', cornerAdvantage: true, bladeAdvantage: 0.7, opponentBearing: 0.9, likelyOpponentResponses: ['retreat'], space: 'usable' } });
  assert.equal(chooseWithFixedRandom(sim), 'zigzag');
});

test('opponent prediction projects retreat velocity and turning motion into the future', () => {
  const player = unit(200, 0, Math.PI); player.vx = 55; player.omega = 0.8;
  const sim = tacticalSimulation({ player });
  const prediction = sim.opponentPrediction();
  assert.ok(prediction.retreatConfidence > 0.5);
  assert.ok(prediction.predicted.x > player.x, 'prediction follows a retreating opponent');
  assert.ok(prediction.turnConfidence > 0);
});

test('tactic hysteresis prevents a short-lived score lead from causing an immediate switch', () => {
  const sim = tacticalSimulation({ player: unit(170, 22, 0) });
  sim.tacticId = 'diagonal'; sim.tacticStartedAt = 0.9; sim.tacticLockUntil = 1.4; sim.time = 1;
  chooseWithFixedRandom(sim);
  assert.equal(sim.tacticId, 'diagonal');
  sim.time = 1.8; sim.tacticStartedAt = 0.9; sim.tacticLockUntil = 0;
  chooseWithFixedRandom(sim);
  assert.ok(sim.tacticId, 'a valid tactic remains selected after the hold window');
});

test('counter selection recognizes motion toward the AI and does not mistake retreat for approach', () => {
  const approaching = unit(200, 0, 0); approaching.vx = -35;
  const approachingSim = tacticalSimulation({ player: approaching });
  assert.equal(chooseWithFixedRandom(approachingSim), 'counter');
  const receding = unit(200, 0, 0); receding.vx = 35;
  const recedingSim = tacticalSimulation({ player: receding });
  assert.notEqual(chooseWithFixedRandom(recedingSim), 'counter');
});

test('tactic selection favors diagonal interception while the opponent is turning', () => {
  const player = unit(200, 0, 0); player.omega = 2;
  const sim = tacticalSimulation({ player });
  assert.equal(chooseWithFixedRandom(sim), 'diagonal');
});

test('tactic selection favors flank with ample free space', () => {
  const sim = tacticalSimulation({ player: unit(250, 0, 0), opening: { placement: 'open', cornerAdvantage: false, bladeAdvantage: 0, space: 'open' } });
  assert.equal(chooseWithFixedRandom(sim), 'flank');
});

test('escape tactic is selected first when the AI is near the dohyo edge', () => {
  const sim = tacticalSimulation({ ai: unit(190, 0, 0), player: unit(280, 0, 0), opening: { placement: 'edge', cornerAdvantage: false, bladeAdvantage: 0, space: 'tight' } });
  assert.equal(chooseWithFixedRandom(sim), 'escape');
});

test('aggression, preferred distance, turn bias, and execution time affect tactic controls', () => {
  const base = tacticalSimulation({ player: unit(170, 22, 0) });
  base.tacticId = 'direct';
  const directBefore = base.controlForTactic();
  base.aiState.tactics.direct.params.aggression *= 0.7;
  const directAfter = base.controlForTactic();
  assert.notDeepEqual(directAfter, directBefore, 'aggression should change drive output');

  const zigzag = tacticalSimulation({ player: unit(170, 22, 0) }); zigzag.tacticId = 'zigzag'; zigzag.time = 0.5;
  const zigzagBefore = zigzag.controlForTactic();
  recordOutcome(zigzag.aiState, 'zigzag', 'player', { failureCause: 'opponent-retreat' });
  assert.equal(zigzag.aiState.tactics.zigzag.params.preferredDistance, 232);
  assert.notDeepEqual(zigzag.controlForTactic(), zigzagBefore, 'learned preferredDistance should change the intercept point');
  const distanceChanged = zigzag.controlForTactic();
  recordOutcome(zigzag.aiState, 'zigzag', 'player', { failureCause: 'late-turn' });
  assert.equal(zigzag.aiState.tactics.zigzag.params.turnBias, 0.494);
  assert.notDeepEqual(zigzag.controlForTactic(), distanceChanged, 'learned turnBias should change zigzag steering');

  const counter = tacticalSimulation({ player: unit(120, 0, 0) }); counter.tacticId = 'counter'; counter.time = 0.805;
  const counterBefore = counter.controlForTactic();
  recordOutcome(counter.aiState, 'counter', 'player', { failureCause: 'late-turn' });
  assert.ok(counter.aiState.tactics.counter.params.executionTime < 1.08);
  assert.notDeepEqual(counter.controlForTactic(), counterBefore, 'learned executionTime should change counter phase timing');

  const diagonal = tacticalSimulation({ player: unit(170, 22, 0) }); diagonal.tacticId = 'diagonal'; diagonal.time = 0.5;
  const diagonalBefore = diagonal.controlForTactic();
  recordOutcome(diagonal.aiState, 'diagonal', 'player', { failureCause: 'late-turn' });
  assert.equal(diagonal.aiState.tactics.diagonal.params.turnBias, 0.614);
  assert.notDeepEqual(diagonal.controlForTactic(), diagonalBefore, 'turnBias learned for diagonal attacks should change steering output');
});

test('AI match records map winners correctly and include draws in match counts', () => {
  const ai = createDefaultAI();
  recordMatchResult(ai, 'ai'); recordMatchResult(ai, 'player'); recordMatchResult(ai, 'draw');
  assert.deepEqual({ matches: ai.matches, wins: ai.wins, losses: ai.losses, draws: ai.draws }, { matches: 3, wins: 1, losses: 1, draws: 1 });
  assert.equal(matchWinRate(ai), 33, 'home and growth screens use AI wins divided by all matches, including draws');
  ai.placementStats.mid = { uses: 2, wins: 1, losses: 1 };
  ai.tactics.direct.placementStats.mid = { uses: 2, wins: 1, failures: 1 };
  ai.tactics.direct.matchups.wait = { uses: 2, wins: 1, failures: 1 };
  recordOutcome(ai, 'direct', 'draw', { opening: { placement: 'mid' }, opponentTactic: 'wait' });
  assert.equal(ai.placementStats.mid.draws, 1); assert.equal(ai.tactics.direct.placementStats.mid.draws, 1);
  assert.equal(ai.tactics.direct.matchups.wait.draws, 1);
});

test('selection, execution, and evaluated tactic results use separate denominators', () => {
  const ai = createDefaultAI();
  recordTacticSelection(ai, 'direct'); recordTacticSelection(ai, 'direct');
  const usage = [
    { tacticId: 'direct', executed: true }, { tacticId: 'zigzag', executed: true },
    { tacticId: 'flank', executed: false }
  ];
  assert.equal(recordTacticExecutions(ai, usage), 2);
  recordOutcome(ai, 'direct', 'ai', { opening: { placement: 'mid' } });
  recordOutcome(ai, 'direct', 'player', { opening: { placement: 'mid' } });
  recordOutcome(ai, 'direct', 'draw', { opening: { placement: 'mid' } });
  const stat = ai.tactics.direct;
  assert.deepEqual({ selections: stat.selections, executions: stat.executions, evaluations: stat.evaluatedMatches, wins: stat.wins, losses: stat.losses, draws: stat.draws, rate: successRate(stat) },
    { selections: 2, executions: 1, evaluations: 3, wins: 1, losses: 1, draws: 1, rate: 33 });
  assert.equal(ai.tactics.zigzag.executions, 1);
  assert.equal(ai.tactics.flank.executions, 0);
});

test('learning changes same-condition tactical control by a measurable amount', () => {
  const ai = createDefaultAI(); const sim = tacticalSimulation({ opening: { placement: 'corner', cornerAdvantage: true, bladeAdvantage: 0.7, space: 'usable' } });
  sim.aiState = ai;
  const selectedBefore = chooseWithFixedRandom(sim);
  const controlBefore = sim.controlForTactic();
  const aggressionBefore = ai.tactics.direct.params.aggression;
  recordMatchResult(ai, 'ai');
  recordOutcome(ai, 'direct', 'ai', { opening: sim.opening, failureCause: 'pressure-success' });
  const selectedAfter = chooseWithFixedRandom(sim);
  const controlAfter = sim.controlForTactic();
  assert.equal(selectedBefore, 'direct'); assert.equal(selectedAfter, 'direct');
  assert.equal(ai.tactics.direct.params.aggression, aggressionBefore + 0.022);
  assert.notDeepEqual(controlAfter, controlBefore, 'same situation must produce different AI controls after the recorded result');
});

test('tactic outcome uses runtime and contact-weighted contribution, not every tactic used', () => {
  const sim = tacticalSimulation();
  sim.tacticUsage = {
    direct: { selectedSeconds: 4, contactSeconds: 0.2 },
    zigzag: { selectedSeconds: 1.2, contactSeconds: 1.5 },
    flank: { selectedSeconds: 0.2, contactSeconds: 0 }
  };
  const evaluated = sim.evaluateTacticUsage();
  assert.equal(evaluated.find((usage) => usage.tacticId === 'direct').executed, true);
  assert.equal(evaluated.find((usage) => usage.tacticId === 'zigzag').executed, true);
  assert.equal(evaluated.find((usage) => usage.tacticId === 'flank').executed, false);
  assert.equal(evaluated[0].tacticId, 'zigzag', 'contact-weighted contribution should determine the evaluated tactic');
});

test('weighted multi-tactic outcomes update each executed tactic without full attribution', () => {
  const ai = createDefaultAI();
  const directBefore = ai.tactics.direct.priority; const zigzagBefore = ai.tactics.zigzag.priority;
  recordOutcome(ai, 'direct', 'player', { contributionWeight: 0.25, opening: { placement: 'mid' } });
  recordOutcome(ai, 'zigzag', 'player', { contributionWeight: 0.75, opening: { placement: 'mid' } });
  assert.equal(ai.tactics.direct.evaluatedMatches, 1); assert.equal(ai.tactics.zigzag.evaluatedMatches, 1);
  assert.ok(directBefore - ai.tactics.direct.priority < zigzagBefore - ai.tactics.zigzag.priority);
});

test('escape is evaluated independently from the match winner', () => {
  const ai = createDefaultAI();
  recordEscapeOutcome(ai, { tacticId: 'escape', startSelfMargin: 8, endSelfMargin: 28, minSelfMargin: 6 });
  recordEscapeOutcome(ai, { tacticId: 'escape', startSelfMargin: 8, endSelfMargin: 9, minSelfMargin: 4 });
  assert.deepEqual(ai.escapeStats, { attempts: 2, recoveries: 1, failures: 1, lastMarginGain: 1 });
});

test('safety control preserves central attack control when footprint margin is healthy', () => {
  const sim = tacticalSimulation({ ai: unit(0, 0, 0), player: unit(170, 0, Math.PI) });
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0; sim.time = 1;
  const control = sim.controlForTactic();
  assert.equal(sim.safetyState.mode, 'attack');
  assert.ok(control.left > 0 && control.right > 0);
});

test('safety control redirects an outward-moving AI near the footprint boundary', () => {
  const ai = unit(182, 0, 0); ai.vx = 35;
  const sim = tacticalSimulation({ ai, player: unit(120, 0, Math.PI) });
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0; sim.time = 1;
  const control = sim.controlForTactic();
  assert.ok(['correcting', 'emergency'].includes(sim.safetyState.mode));
  assert.ok(control.left < 0 && control.right < 0, 'near-edge outward travel should receive inward drive');
});

test('ring-out result identifies whether AI or opponent left the dohyo', () => {
  const sim = simulation(unit(244, 0, 0), unit(0, 0, Math.PI));
  sim.aiState = createDefaultAI(); sim.time = 4; sim.aiDecisionTimer = 10;
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0; sim.flankSide = 1; sim.usedTactics = new Set(); sim.tacticHistory = [];
  sim.input = { left: 0, right: 0 }; sim.frame = 0; sim.running = true; sim.draw = () => {};
  let result = null; sim.onFinish = (outcome) => { result = outcome; };
  sim.update(1 / 60);
  assert.equal(result?.aiOut, false); assert.equal(result?.playerOut, true); assert.equal(result?.tacticBeforeRingOut, 'direct');
});

test('ring-out detection follows the oriented robot footprint', () => {
  const sim = simulation(unit(190, 0, 0), unit(0, 0, Math.PI));
  assert.equal(sim.isOut(sim.player), true, 'front blade extending past the ring is out');
  sim.player.angle = Math.PI;
  // With 100mm × 100mm square robot, facing inward the corners still extend further
  // than the center, so the robot is still considered out when at the rim
  assert.equal(sim.isOut(sim.player), true, 'the same center is still out when facing inward with square robot');
});

test('ring-out after a push resolves the winner in the battle update path', () => {
  const p = unit(244, 0, 0); const ai = unit(0, 0, Math.PI);
  const sim = simulation(p, ai); sim.aiState = createDefaultAI(); sim.time = 4; sim.aiDecisionTimer = 10;
  sim.tacticId = 'direct'; sim.tacticStartedAt = 0; sim.flankSide = 1;
  sim.usedTactics = new Set(); sim.tacticHistory = []; sim.input = { left: 0, right: 0 };
  sim.frame = 0; sim.running = true; sim.draw = () => {};
  let result = null; sim.onFinish = (outcome) => { result = outcome; };
  sim.update(1 / 60);
  assert.equal(result?.winner, 'ai');
  assert.match(result?.reason || '', /押し出し/);
});

test('saved AI development data is still loaded and written to the existing key', () => {
  const prior = globalThis.localStorage;
  const seed = createDefaultAI(); seed.version = 2; seed.matches = 9; seed.wins = 6; seed.losses = 2; seed.draws = 1;
  seed.tactics.direct.uses = 12; seed.tactics.direct.successes = 4; seed.tactics.direct.failures = 7; seed.tactics.direct.params.aggression = 0.91;
  TACTICS.forEach(({ id }) => {
    delete seed.tactics[id].selections; delete seed.tactics[id].executions; delete seed.tactics[id].evaluatedMatches;
    delete seed.tactics[id].wins; delete seed.tactics[id].losses; delete seed.tactics[id].draws;
  });
  const records = new Map([['sumo500-ai-v2', JSON.stringify(seed)]]);
  globalThis.localStorage = { getItem: (key) => records.get(key) || null, setItem: (key, value) => records.set(key, value) };
  try {
    const restored = loadAI();
    assert.equal(restored.matches, 9); assert.equal(restored.wins, 2); assert.equal(restored.losses, 6); assert.equal(restored.draws, 1); assert.equal(restored.tactics.direct.uses, 12);
    assert.equal(restored.version, DATA_VERSION); assert.equal(restored.tactics.direct.selections, 12);
    assert.equal(restored.tactics.direct.executions, 0); assert.equal(restored.tactics.direct.evaluatedMatches, 0);
    assert.equal(restored.tactics.direct.wins + restored.tactics.direct.losses + restored.tactics.direct.draws, restored.tactics.direct.evaluatedMatches);
    assert.equal(restored.tactics.direct.successes, 0); assert.equal(restored.tactics.direct.failures, 0, 'legacy tactic outcomes without execution evidence must not be carried into the new evaluation metric');
    assert.equal(restored.tactics.direct.params.aggression, 0.91);
    recordMatchResult(restored, 'ai'); recordTacticSelection(restored, 'zigzag');
    recordTacticExecutions(restored, [{ tacticId: 'zigzag', executed: true }]);
    recordOutcome(restored, 'zigzag', 'ai', { opening: { placement: 'corner' } }); saveAI(restored);
    const reloaded = loadAI();
    assert.equal(reloaded.matches, 10); assert.equal(reloaded.wins, 3); assert.equal(reloaded.losses, 6);
    assert.equal(reloaded.tactics.zigzag.selections, 1); assert.equal(reloaded.tactics.zigzag.executions, 1);
    assert.equal(reloaded.tactics.zigzag.evaluatedMatches, 1); assert.equal(reloaded.tactics.zigzag.wins, 1);
    assert.equal(reloaded.tactics.zigzag.wins + reloaded.tactics.zigzag.losses + reloaded.tactics.zigzag.draws, reloaded.tactics.zigzag.evaluatedMatches);
    reloaded.escapeStats = { attempts: 3, recoveries: 2, failures: 1, lastMarginGain: 14.5 }; saveAI(reloaded);
    assert.deepEqual(loadAI().escapeStats, reloaded.escapeStats, 'escape recovery statistics must persist with existing AI data');
  } finally {
    if (prior === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior;
  }
});
