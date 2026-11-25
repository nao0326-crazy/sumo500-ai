// Physics checks added for the final release: wheel direction, tyre friction circle,
// side push (slip + yaw), blade wedge load transfer, rear push, edge ring-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSimulation, contactManifold } from './game.js';

const unit = (x, y, angle, extra = {}) => ({ x, y, angle, vx: 0, vy: 0, omega: 0, left: 0, right: 0, drivePower: 1, mass: 1, inertia: 330, loadFactor: 1, trail: [], ...extra });
const pair = (p, ai) => { const sim = Object.create(BattleSimulation.prototype); sim.player = p; sim.ai = ai; return sim; };
const signedAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function run(sim, frames, cp, ca, dt = 1 / 120) {
  for (let i = 0; i < frames; i += 1) {
    Object.assign(sim.player, cp); Object.assign(sim.ai, ca);
    sim.applyDrive(sim.player, dt); sim.applyDrive(sim.ai, dt); sim.resolveRobotCollision(dt);
  }
}
function drive(r, left, right, frames = 60) { const sim = pair(r, unit(500, 500, 0)); for (let i = 0; i < frames; i += 1) { r.left = left; r.right = right; sim.applyDrive(r, 1 / 120); } return r; }

test('differential drive: right wheel forward alone turns the robot LEFT (counter-clockwise on screen)', () => {
  const r = drive(unit(0, 0, 0), 0, 1);
  assert.ok(signedAngle(r.angle) < -0.3, `heading should rotate counter-clockwise, got ${signedAngle(r.angle).toFixed(2)}`);
  assert.ok(r.y < 0, 'pivoting around the left wheel moves the centre toward the robot\'s left (screen up)');
});

test('differential drive: left wheel forward alone turns the robot RIGHT (clockwise on screen)', () => {
  const r = drive(unit(0, 0, 0), 1, 0);
  assert.ok(signedAngle(r.angle) > 0.3, `heading should rotate clockwise, got ${signedAngle(r.angle).toFixed(2)}`);
});

test('differential drive: equal commands go straight forward or backward; opposite commands spin in place', () => {
  const fwd = drive(unit(0, 0, 0), 1, 1); assert.ok(fwd.x > 20 && Math.abs(fwd.y) < 0.01 && Math.abs(signedAngle(fwd.angle)) < 0.001);
  const back = drive(unit(0, 0, 0), -1, -1); assert.ok(back.x < -20 && Math.abs(back.y) < 0.01);
  // The axle sits 4 units ahead of the centre of mass, so the centre traces a small circle.
  const spin = drive(unit(0, 0, 0), -1, 1); assert.ok(Math.hypot(spin.x, spin.y) < 10 && Math.abs(signedAngle(spin.angle)) > 1);
});

test('tyre friction circle: driving hard leaves less side grip, so the same side slip decays more slowly', () => {
  const slipAfter = (command) => {
    const r = unit(0, 0, 0); r.vy = 60; // pure sideways slip (side vector = +y for heading 0)
    const sim = pair(r, unit(500, 500, 0));
    for (let i = 0; i < 6; i += 1) { r.left = command; r.right = command; sim.applyDrive(r, 1 / 120); }
    return Math.abs(r.vx * -Math.sin(r.angle) + r.vy * Math.cos(r.angle));
  };
  const coasting = slipAfter(0); const accelerating = slipAfter(1);
  assert.ok(accelerating > coasting + 5, `side slip should persist when grip is used for driving (coast ${coasting.toFixed(1)}, drive ${accelerating.toFixed(1)})`);
});

test('high-speed turn slides sideways instead of following the wheels exactly', () => {
  const r = unit(0, 0, 0); const sim = pair(r, unit(500, 500, 0));
  for (let i = 0; i < 240; i += 1) { r.left = 1; r.right = i > 120 ? 0.2 : 1; sim.applyDrive(r, 1 / 120); }
  const f = { x: Math.cos(r.angle), y: Math.sin(r.angle) }; const s = { x: -f.y, y: f.x };
  assert.ok(Math.abs(r.vx * s.x + r.vy * s.y) > 4, 'a fast turn must show lateral slip');
});

test('a blade on the opponent\'s side lifts it (less grip) and presses the attacker down (more grip)', () => {
  const sim = pair(unit(0, 0, 0), unit(0, 52, -Math.PI / 2)); // AI blade against player's side
  run(sim, 60, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(sim.player.loadFactor < 0.85, `struck robot should lose load, got ${sim.player.loadFactor.toFixed(2)}`);
  assert.ok(sim.ai.loadFactor > 1.15, `attacker should gain load, got ${sim.ai.loadFactor.toFixed(2)}`);
});

test('blade-to-blade contact cancels the wedge: loads stay equal and the shove balances', () => {
  const sim = pair(unit(-29.4, 0, 0), unit(29.4, 0, Math.PI));
  run(sim, 120, { left: 1, right: 1 }, { left: 1, right: 1 });
  assert.ok(Math.abs(sim.player.loadFactor - 1) < 0.02 && Math.abs(sim.ai.loadFactor - 1) < 0.02);
  assert.ok(Math.abs(sim.player.x + sim.ai.x) < 4);
});

test('side push produces BOTH lateral sliding and rotation of the struck robot', () => {
  const sim = pair(unit(15, 0, 0), unit(0, 52, -Math.PI / 2)); // off-centre hit on the player's side
  run(sim, 240, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(sim.player.y < -30, `struck robot should slide sideways, got y=${sim.player.y.toFixed(1)}`);
  assert.ok(Math.abs(signedAngle(sim.player.angle)) > 0.4, `off-centre side push should yaw it, got ${signedAngle(sim.player.angle).toFixed(2)}`);
});

test('a side-pushed robot cannot push back: driving forward does not stop the sideways slide', () => {
  const sim = pair(unit(0, 0, 0), unit(0, 52, -Math.PI / 2));
  run(sim, 120, { left: 1, right: 1 }, { left: 1, right: 1 });
  assert.ok(sim.player.x > 40, 'the struck robot escapes along its own axis (its motors act longitudinally)');
});

test('pushed from behind, a robot cannot hold ground even at full reverse; head-on at full power it can', () => {
  // Head-on: both blades, both full power -> balance.
  const front = pair(unit(-29.4, 0, 0), unit(29.4, 0, Math.PI)); run(front, 240, { left: 1, right: 1 }, { left: 1, right: 1 });
  assert.ok(Math.abs(front.ai.x - 30.8) < 3, `head-on should balance, AI x=${front.ai.x.toFixed(1)}`);
  // Rear: the defender reverses into the attacker at full power, but the blade lifts its rear.
  const rear = pair(unit(-29.4, 0, 0), unit(29.4, 0, 0)); run(rear, 240, { left: 1, right: 1 }, { left: -1, right: -1 });
  assert.ok(rear.ai.x > 36, `rear-pushed robot should be driven away, AI x=${rear.ai.x.toFixed(1)}`);
  assert.ok(rear.ai.loadFactor < 0.85 && rear.player.loadFactor > 1.15, 'load moves from the struck robot to the attacker');
});

test('a robot pushed at the rim leaves the ring by footprint, not by centre', () => {
  const sim = pair(unit(128, 0, 0), unit(188, 0, Math.PI / 2));
  assert.equal(sim.isOut(sim.ai), false);
  let frames = 0;
  while (!sim.isOut(sim.ai) && frames < 400) { run(sim, 1, { left: 1, right: 1 }, { left: 0, right: 0 }); frames += 1; }
  assert.equal(sim.isOut(sim.ai), true, 'the push must reach ring-out');
  assert.ok(Math.hypot(sim.ai.x, sim.ai.y) < 220, 'ring-out is decided by the chassis outline while the centre is still inside');
});

test('the same physics applies to both robots (mirrored scenario gives mirrored result)', () => {
  const a = pair(unit(-29.4, 0, 0), unit(29.4, 0, 0)); run(a, 90, { left: 1, right: 1 }, { left: 0, right: 0 });
  const b = pair(unit(-29.4, 0, Math.PI), unit(29.4, 0, Math.PI)); run(b, 90, { left: 0, right: 0 }, { left: 1, right: 1 });
  assert.ok(Math.abs(a.ai.x + b.player.x) < 0.5 && Math.abs(a.player.x + b.ai.x) < 0.5, 'player and AI must be treated identically');
});

test('contact never leaves robots deeply interpenetrating in a sustained diagonal shove', () => {
  const sim = pair(unit(0, 0, 0.4), unit(44, 25, Math.atan2(-25, -44)));
  run(sim, 240, { left: 1, right: 0.6 }, { left: 1, right: 1 });
  const m = contactManifold(sim.player, sim.ai);
  assert.ok(!m || m.overlap < 2);
});
