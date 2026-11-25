import { TACTICS, tacticById, recordTacticSelection, saveAI } from './data.js';

const ARENA_RADIUS = 220;
const ROBOT_RADIUS = 32;
const MAX_SPEED = 142;
const TURN_SPEED = 3.6;
const DRIVE_ACCEL = 390;
const WHEEL_HALF_TRACK = 15;
const BODY_INERTIA = 330;
const CONTACT_SLOP = 0.32;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const norm = (v) => { const length = Math.hypot(v.x, v.y) || 1; return { x: v.x / length, y: v.y / length }; };
const angleDelta = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const forwardOf = (unit) => ({ x: Math.cos(unit.angle), y: Math.sin(unit.angle) });
const sideOf = (unit) => { const f = forwardOf(unit); return { x: -f.y, y: f.x }; };

// Convex footprint: the shallow forward shoulders and broad blade are part of the
// collision shape, rather than an invisible circle around the robot's center.
const FOOTPRINT = [
  { x: 31, y: -10 }, { x: 26, y: -21 }, { x: 18, y: -23 },
  { x: -24, y: -23 }, { x: -28, y: -18 }, { x: -28, y: 18 },
  { x: -24, y: 23 }, { x: 18, y: 23 }, { x: 26, y: 21 }, { x: 31, y: 10 }
];

function robot(x, y, angle, color, accent, name, sprite) {
  return { x, y, angle, color, accent, name, sprite, vx: 0, vy: 0, omega: 0,
    left: 0, right: 0, drivePower: 1, mass: 1, inertia: BODY_INERTIA, trail: [] };
}

function worldFootprint(unit) {
  const f = forwardOf(unit); const s = sideOf(unit);
  return FOOTPRINT.map((point) => ({ x: unit.x + f.x * point.x + s.x * point.y, y: unit.y + f.y * point.x + s.y * point.y }));
}

function polygonAxes(polygon) {
  const axes = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    axes.push(norm({ x: -(b.y - a.y), y: b.x - a.x }));
  }
  return axes;
}

function projectPolygon(polygon, axis) {
  let min = Infinity; let max = -Infinity;
  for (const point of polygon) { const value = dot(point, axis); min = Math.min(min, value); max = Math.max(max, value); }
  return { min, max };
}

function supportPoint(polygon, direction) {
  const values = polygon.map((point) => dot(point, direction));
  const max = Math.max(...values); const supports = polygon.filter((_, index) => max - values[index] < 1.25);
  return supports.reduce((sum, point) => ({ x: sum.x + point.x / supports.length, y: sum.y + point.y / supports.length }), { x: 0, y: 0 });
}

function contactManifold(a, b) {
  const polygonA = worldFootprint(a); const polygonB = worldFootprint(b); let minimumOverlap = Infinity; let normal = null;
  for (const axis of [...polygonAxes(polygonA), ...polygonAxes(polygonB)]) {
    const pa = projectPolygon(polygonA, axis); const pb = projectPolygon(polygonB, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= 0) return null;
    if (overlap < minimumOverlap) { minimumOverlap = overlap; normal = axis; }
  }
  if (dot({ x: b.x - a.x, y: b.y - a.y }, normal) < 0) normal = { x: -normal.x, y: -normal.y };
  const pointA = supportPoint(polygonA, normal); const pointB = supportPoint(polygonB, { x: -normal.x, y: -normal.y });
  return { normal, overlap: minimumOverlap, point: { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 } };
}

function pointVelocity(unit, point) {
  const rx = point.x - unit.x; const ry = point.y - unit.y;
  return { x: unit.vx - unit.omega * ry, y: unit.vy + unit.omega * rx };
}

function applyImpulse(unit, impulse, point) {
  const invMass = 1 / unit.mass; const rx = point.x - unit.x; const ry = point.y - unit.y;
  unit.vx += impulse.x * invMass; unit.vy += impulse.y * invMass;
  unit.omega += cross({ x: rx, y: ry }, impulse) / unit.inertia;
}

export class BattleSimulation {
  constructor(canvas, aiState, { onUpdate, onFinish }) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.aiState = aiState;
    this.onUpdate = onUpdate; this.onFinish = onFinish; this.running = false; this.ended = false;
    this.frame = 0; this.lastTime = 0; this.time = 0; this.countdown = 3.1; this.aiDecisionTimer = 0;
    this.tacticId = ''; this.tacticStartedAt = 0; this.tacticLockUntil = 0; this.flankSide = Math.random() > 0.5 ? 1 : -1;
    this.usedTactics = new Set(); this.tacticHistory = []; this.tacticUsage = {}; this.input = { left: 0, right: 0 };
    this.width = 620; this.height = 620;
    this.player = robot(-112, 0, 0, '#ffb04a', '#fff2bf', 'YOU', '/assets/robot-player-sprite.png');
    this.ai = robot(112, 0, Math.PI, '#52d6c5', '#d9fff7', 'AI', '/assets/robot-ai-sprite.png');
    this.sprites = { player: this.loadSprite(this.player.sprite), ai: this.loadSprite(this.ai.sprite) };
    this.opening = this.analyzeOpening(); this.resize();
  }

  loadSprite(source) {
    if (typeof Image === 'undefined') return null;
    const image = new Image(); image.src = source; return image;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(280, rect.width || 620); this.height = Math.max(280, rect.height || 440);
    this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.draw();
  }

  analyzeOpening() {
    const distance = dist(this.ai, this.player);
    const selfEdge = Math.hypot(this.ai.x, this.ai.y);
    const opponentEdge = Math.hypot(this.player.x, this.player.y);
    const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y });
    const awayFromPlayer = { x: -toPlayer.x, y: -toPlayer.y };
    const selfBearing = Math.abs(angleDelta(Math.atan2(toPlayer.y, toPlayer.x) - this.ai.angle));
    const opponentBearing = Math.abs(angleDelta(Math.atan2(awayFromPlayer.y, awayFromPlayer.x) - this.player.angle));
    const edgeClearance = ARENA_RADIUS - selfEdge;
    const opponentClearance = ARENA_RADIUS - opponentEdge;
    const bladeAdvantage = clamp((opponentBearing - selfBearing) / Math.PI + (opponentBearing > 0.65 ? 0.32 : 0), -1, 1);
    const cornerAdvantage = bladeAdvantage > 0.24 || (opponentBearing > 0.9 && selfBearing < 0.65);
    const placement = selfEdge > 170 ? 'edge' : cornerAdvantage && distance < 270 ? 'corner' : distance < 125 ? 'close' : distance > 285 ? 'open' : 'mid';
    const freeSpace = clamp(((edgeClearance + opponentClearance) / 2) / ARENA_RADIUS, 0, 1);
    const likelyOpponentResponses = [];
    if (cornerAdvantage && distance > 135) likelyOpponentResponses.push('retreat');
    if (distance > 150 && freeSpace > 0.48) likelyOpponentResponses.push('zigzag');
    if (selfEdge > 170 || opponentEdge > 170) likelyOpponentResponses.push('wait');
    if (!likelyOpponentResponses.length) likelyOpponentResponses.push('direct');
    return {
      placement, distance, selfEdge, opponentEdge, edgeClearance, opponentClearance, freeSpace,
      selfBearing, opponentBearing, bladeAdvantage, cornerAdvantage, likelyOpponentResponses,
      space: freeSpace > 0.58 ? 'open' : freeSpace < 0.28 ? 'tight' : 'usable'
    };
  }

  setInput(side, value) { this.input[side] = clamp(value, -1, 1); }
  start() { this.running = true; this.lastTime = performance.now(); this.selectTactic(true); this.loop(this.lastTime); }
  stop() { this.running = false; }

  loop(timestamp) {
    if (!this.running) return;
    const dt = Math.min(0.034, Math.max(0.001, (timestamp - this.lastTime) / 1000)); this.lastTime = timestamp;
    if (!this.ended) {
      if (this.countdown > 0) this.countdown -= dt; else { this.time += dt; this.update(dt); }
      this.draw(); this.onUpdate?.(this.snapshot());
    }
    this.frame = requestAnimationFrame((next) => this.loop(next));
  }

  snapshot() {
    const tactic = tacticById(this.tacticId || 'direct');
    return { countdown: Math.max(0, this.countdown), time: this.time, tacticName: tactic.name, tacticId: tactic.id,
      playerEdge: Math.round(Math.hypot(this.player.x, this.player.y)), aiEdge: Math.round(Math.hypot(this.ai.x, this.ai.y)),
      distance: Math.round(dist(this.player, this.ai)), placement: this.opening.placement, bladeAdvantage: this.opening.bladeAdvantage };
  }

  update(dt) {
    this.aiDecisionTimer -= dt;
    if (this.aiDecisionTimer <= 0) { this.selectTactic(false); this.aiDecisionTimer = 0.34 + Math.random() * 0.18; }
    const aiControl = this.controlForTactic();
    this.player.left = this.input.left; this.player.right = this.input.right;
    this.ai.left = aiControl.left; this.ai.right = aiControl.right;
    this.applyDrive(this.player, dt); this.applyDrive(this.ai, dt);
    const touching = this.resolveRobotCollision(dt);
    if (this.tacticId) {
      this.tacticUsage ||= {};
      const usage = this.tacticUsage[this.tacticId] || this.createTacticUsage();
      usage.selectedSeconds += dt;
      if (touching) usage.contactSeconds += dt;
      usage.endDistance = dist(this.ai, this.player);
      usage.endSelfMargin = this.footprintMargin(this.ai);
      usage.endOpponentMargin = this.footprintMargin(this.player);
      usage.endAngleGap = this.angleGapToOpponent();
      usage.minSelfMargin = Math.min(usage.minSelfMargin, usage.endSelfMargin);
      this.tacticUsage[this.tacticId] = usage;
    }
    this.keepTrails();
    const playerOut = this.isOut(this.player); const aiOut = this.isOut(this.ai);
    if (playerOut || aiOut) {
      const winner = playerOut && aiOut ? 'draw' : playerOut ? 'ai' : 'player';
      this.finish(winner, winner === 'draw' ? '両機体が場外' : '土俵外へ押し出し', { aiOut, playerOut });
    } else if (this.time > 58) {
      const playerCenter = Math.hypot(this.player.x, this.player.y); const aiCenter = Math.hypot(this.ai.x, this.ai.y);
      const winner = Math.abs(playerCenter - aiCenter) < 8 ? 'draw' : playerCenter < aiCenter ? 'player' : 'ai';
      this.finish(winner, '時間切れ・中心距離判定');
    }
  }

  isOut(unit) { return worldFootprint(unit).some((point) => Math.hypot(point.x, point.y) > ARENA_RADIUS); }

  footprintMargin(unit) { return Math.min(...worldFootprint(unit).map((point) => ARENA_RADIUS - Math.hypot(point.x, point.y))); }

  radialOutwardSpeed(unit) {
    const radial = norm({ x: unit.x, y: unit.y });
    return dot({ x: unit.vx, y: unit.vy }, radial);
  }

  angleGapToOpponent() {
    const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y });
    return Math.abs(angleDelta(Math.atan2(toPlayer.y, toPlayer.x) - this.ai.angle));
  }

  createTacticUsage() {
    const distance = dist(this.ai, this.player); const selfMargin = this.footprintMargin(this.ai);
    const opponentMargin = this.footprintMargin(this.player); const angleGap = this.angleGapToOpponent();
    return { selectedSeconds: 0, contactSeconds: 0, startDistance: distance, endDistance: distance,
      startSelfMargin: selfMargin, endSelfMargin: selfMargin, startOpponentMargin: opponentMargin,
      endOpponentMargin: opponentMargin, startAngleGap: angleGap, endAngleGap: angleGap, minSelfMargin: selfMargin };
  }

  // Differential-drive wheel forces accelerate the chassis; grip damps lateral slip,
  // while the left/right force difference produces wheelbase torque and yaw inertia.
  applyDrive(unit, dt) {
    const forward = forwardOf(unit); const side = sideOf(unit);
    const longitudinalSpeed = dot({ x: unit.vx, y: unit.vy }, forward);
    const lateralSpeed = dot({ x: unit.vx, y: unit.vy }, side);
    const leftSpeed = longitudinalSpeed - unit.omega * WHEEL_HALF_TRACK;
    const rightSpeed = longitudinalSpeed + unit.omega * WHEEL_HALF_TRACK;
    const motorScale = unit.drivePower ?? 1;
    const leftAccel = clamp((unit.left * MAX_SPEED - leftSpeed) * 4.5, -DRIVE_ACCEL * motorScale, DRIVE_ACCEL * motorScale);
    const rightAccel = clamp((unit.right * MAX_SPEED - rightSpeed) * 4.5, -DRIVE_ACCEL * motorScale, DRIVE_ACCEL * motorScale);
    const forwardAccel = (leftAccel + rightAccel) * 0.5;
    const angularAccel = (rightAccel - leftAccel) / (2 * WHEEL_HALF_TRACK);

    unit.vx += forward.x * forwardAccel * dt + side.x * (-lateralSpeed * 5.2) * dt;
    unit.vy += forward.y * forwardAccel * dt + side.y * (-lateralSpeed * 5.2) * dt;
    unit.vx *= Math.exp(-0.28 * dt); unit.vy *= Math.exp(-0.28 * dt);
    unit.omega += angularAccel * dt;
    unit.omega *= Math.exp(-1.15 * dt);
    const maxOmega = TURN_SPEED * 1.28;
    unit.omega = clamp(unit.omega, -maxOmega, maxOmega);
    const speed = Math.hypot(unit.vx, unit.vy);
    if (speed > MAX_SPEED) { unit.vx *= MAX_SPEED / speed; unit.vy *= MAX_SPEED / speed; }
    unit.angle = (unit.angle + unit.omega * dt + TAU) % TAU;
    unit.x += unit.vx * dt; unit.y += unit.vy * dt;
  }

  resolveRobotCollision() {
    const a = this.player; const b = this.ai; const manifold = contactManifold(a, b);
    if (!manifold) return false;
    const { normal, overlap, point } = manifold;
    const invMassA = 1 / a.mass; const invMassB = 1 / b.mass; const invTotal = invMassA + invMassB;

    // Small, damped positional correction removes penetration without snapping or jitter.
    const correctionMagnitude = Math.max(overlap - CONTACT_SLOP, 0) * 0.78 / invTotal;
    if (correctionMagnitude > 0) {
      a.x -= normal.x * correctionMagnitude * invMassA;
      a.y -= normal.y * correctionMagnitude * invMassA;
      b.x += normal.x * correctionMagnitude * invMassB;
      b.y += normal.y * correctionMagnitude * invMassB;
    }

    const velocityA = pointVelocity(a, point); const velocityB = pointVelocity(b, point);
    const relative = { x: velocityB.x - velocityA.x, y: velocityB.y - velocityA.y };
    const normalSpeed = dot(relative, normal);
    const ra = { x: point.x - a.x, y: point.y - a.y }; const rb = { x: point.x - b.x, y: point.y - b.y };
    const raCrossN = cross(ra, normal); const rbCrossN = cross(rb, normal);
    const normalDenominator = invMassA + invMassB + raCrossN * raCrossN / a.inertia + rbCrossN * rbCrossN / b.inertia;
    if (normalSpeed < 0 && normalDenominator > 0) {
      const normalImpulseMagnitude = -(1 + 0.035) * normalSpeed / normalDenominator;
      const normalImpulse = { x: normal.x * normalImpulseMagnitude, y: normal.y * normalImpulseMagnitude };
      applyImpulse(a, { x: -normalImpulse.x, y: -normalImpulse.y }, point);
      applyImpulse(b, normalImpulse, point);

      // Contact friction transfers lateral force and spin at the actual blade/side contact.
      const va = pointVelocity(a, point); const vb = pointVelocity(b, point);
      const tangentVelocity = { x: vb.x - va.x, y: vb.y - va.y };
      const tangentRaw = { x: tangentVelocity.x - dot(tangentVelocity, normal) * normal.x, y: tangentVelocity.y - dot(tangentVelocity, normal) * normal.y };
      const tangentLength = Math.hypot(tangentRaw.x, tangentRaw.y);
      if (tangentLength > 1e-6) {
        const tangent = { x: tangentRaw.x / tangentLength, y: tangentRaw.y / tangentLength };
        const raCrossT = cross(ra, tangent); const rbCrossT = cross(rb, tangent);
        const tangentDenominator = invMassA + invMassB + raCrossT * raCrossT / a.inertia + rbCrossT * rbCrossT / b.inertia;
        const tangentSpeed = dot(tangentVelocity, tangent);
        const friction = clamp(-tangentSpeed / tangentDenominator, -normalImpulseMagnitude * 0.58, normalImpulseMagnitude * 0.58);
        const frictionImpulse = { x: tangent.x * friction, y: tangent.y * friction };
        applyImpulse(a, { x: -frictionImpulse.x, y: -frictionImpulse.y }, point);
        applyImpulse(b, frictionImpulse, point);
      }
    }
    return true;
  }

  inferOpponentPattern() {
    const speed = Math.hypot(this.player.vx, this.player.vy); const facing = forwardOf(this.player); const forwardMomentum = dot({ x: this.player.vx, y: this.player.vy }, facing);
    const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y });
    const awayMomentum = dot({ x: this.player.vx, y: this.player.vy }, toPlayer);
    if (Math.abs(this.player.omega) > 1.35) return 'zigzag';
    if (awayMomentum > 18 || forwardMomentum < -18 || (this.player.left + this.player.right) < -0.3) return 'retreat';
    if (speed > 44) return 'direct';
    return 'wait';
  }

  opponentPrediction() {
    const distance = dist(this.ai, this.player); const velocity = { x: this.player.vx, y: this.player.vy };
    const speed = Math.hypot(velocity.x, velocity.y); const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y });
    const awayMomentum = dot(velocity, toPlayer); const lateralMomentum = Math.abs(cross(velocity, toPlayer));
    const retreatConfidence = clamp((awayMomentum - 8) / 72, 0, 1);
    const turnConfidence = clamp((Math.abs(this.player.omega) - 0.35) / 1.8, 0, 1);
    const horizon = clamp(0.42 + distance / 420 + retreatConfidence * 0.28, 0.42, 1.22);
    const predicted = { x: this.player.x + velocity.x * horizon, y: this.player.y + velocity.y * horizon };
    const heading = forwardOf(this.player);
    if (awayMomentum > 0) { predicted.x += heading.x * 18 * retreatConfidence; predicted.y += heading.y * 18 * retreatConfidence; }
    return { distance, speed, awayMomentum, lateralMomentum, retreatConfidence, turnConfidence, horizon, predicted };
  }

  selectTactic(isOpening) {
    const d = dist(this.ai, this.player); const selfEdge = Math.hypot(this.ai.x, this.ai.y); const opponentEdge = Math.hypot(this.player.x, this.player.y);
    const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y }); const enemyFacing = dot(forwardOf(this.player), { x: -toPlayer.x, y: -toPlayer.y });
    const enemyMomentum = dot({ x: this.player.vx, y: this.player.vy }, toPlayer); const opponentPattern = this.inferOpponentPattern();
    const prediction = this.opponentPrediction(); const selfMargin = this.footprintMargin(this.ai);
    const openingPredictsRetreat = this.opening.likelyOpponentResponses?.includes('retreat') ||
      (this.opening.cornerAdvantage && d > 135 && this.opening.opponentBearing > 0.55);
    const emergency = selfEdge > 184 || this.opening.edgeClearance < 28;
    const scores = TACTICS.map((def) => {
      const stat = this.aiState.tactics[def.id]; let score = stat.priority;
      if (def.opening.placements.includes(this.opening.placement)) score += 0.68; else score -= 0.12;
      if (d >= def.opening.distances[0] && d <= def.opening.distances[1]) score += 0.42; else score -= 0.15;
      if (def.id === 'escape') score += selfMargin < 16 ? 8.4 : selfMargin < 42 ? 4.8 : selfMargin < 70 ? 1.4 : -2.4;
      if (def.id === 'direct') { score += this.opening.cornerAdvantage ? 2.1 : -0.28; if (opponentPattern === 'retreat' || openingPredictsRetreat) score -= 1.1; }
      if (def.id === 'zigzag') {
        score += this.opening.cornerAdvantage && d > 135 ? 1.65 : -0.1;
        if (opponentPattern === 'retreat') score += 0.8;
        if (openingPredictsRetreat && d >= 150 && this.opening.space !== 'tight') score += 2.35;
        if (prediction.retreatConfidence > 0.22 && d >= 120 && d <= 330) score += 2.8 * prediction.retreatConfidence;
        if (prediction.turnConfidence > 0.2) score += 0.7 * prediction.turnConfidence;
      }
      if (def.id === 'flank') score += this.opening.space === 'open' && d > 170 ? 1.2 : -0.6;
      if (def.id === 'diagonal') score += Math.abs(this.player.omega) > 0.65 || Math.hypot(this.player.vx, this.player.vy) > 42 ? 1.45 : 0.04;
      if (def.id === 'doubleZigzag') score += (this.tacticId === 'zigzag' || this.tacticId === 'diagonal') && this.time - this.tacticStartedAt > 0.28 ? 2.0 : -0.4;
      if (def.id === 'counter') score += this.opening.placement === 'edge' ? 2.0 : enemyMomentum < -28 ? 2.0 : enemyMomentum < -8 ? 0.55 : -0.35;
      if (def.id === 'reposition') score += d < 82 ? 2.1 : -0.1;
      if (opponentEdge > 170 && def.id !== 'escape') score += 0.3;
      if (!isOpening && def.id === this.tacticId) {
        const currentExecutionTime = clamp(this.aiState.tactics[this.tacticId]?.params?.executionTime ?? 0.8, 0.45, 1.6);
        const elapsed = Math.max(0, this.time - this.tacticStartedAt);
        score += 0.42 + 0.55 * clamp(1 - elapsed / currentExecutionTime, 0, 1);
        if (this.time < this.tacticLockUntil) score += 0.85;
      }
      return { def, score };
    }).sort((a, b) => b.score - a.score);
    const current = scores.find((candidate) => candidate.def.id === this.tacticId);
    let chosen = Math.random() < 0.1 ? scores[Math.floor(Math.random() * Math.min(3, scores.length))] : scores[0];
    if (current && !emergency && chosen.def.id !== current.def.id) {
      const elapsed = Math.max(0, this.time - this.tacticStartedAt);
      const minHold = clamp(this.aiState.tactics[this.tacticId]?.params?.executionTime ?? 0.8, 0.45, 1.6) * 0.48;
      const meaningfulLead = 0.24;
      if (this.time < this.tacticLockUntil || elapsed < minHold || chosen.score < current.score + meaningfulLead) chosen = current;
    }
    if (chosen.def.id !== this.tacticId) {
      this.tacticId = chosen.def.id; this.tacticStartedAt = this.time;
      this.tacticLockUntil = this.time + (chosen.def.id === 'escape' ? 0.72 : 0.34);
      if (chosen.def.id === 'flank' || chosen.def.id === 'zigzag' || chosen.def.id === 'doubleZigzag') this.flankSide = Math.random() > 0.5 ? 1 : -1;
      this.usedTactics.add(chosen.def.id); this.tacticHistory.push({ id: chosen.def.id, at: this.time, opening: this.opening.placement, opponentPattern });
      recordTacticSelection(this.aiState, chosen.def.id); saveAI(this.aiState);
    }
  }

  evaluateTacticUsage() {
    return Object.entries(this.tacticUsage || {}).map(([tacticId, usage]) => {
      const executionTime = clamp(this.aiState?.tactics?.[tacticId]?.params?.executionTime ?? tacticById(tacticId).defaultParams.executionTime, 0.45, 1.6);
      const minExecutionSeconds = Math.max(0.4, executionTime * 0.35);
      const score = usage.selectedSeconds + usage.contactSeconds * 2.5;
      const distanceProgress = (usage.startDistance ?? 0) - (usage.endDistance ?? usage.startDistance ?? 0);
      const marginProgress = (usage.endSelfMargin ?? 0) - (usage.startSelfMargin ?? 0);
      const angleProgress = (usage.startAngleGap ?? 0) - (usage.endAngleGap ?? usage.startAngleGap ?? 0);
      const stateChange = distanceProgress / 100 + marginProgress / 40 + angleProgress * 0.25;
      const progressScore = Math.max(0, stateChange) + Math.max(0, usage.contactSeconds * 0.65);
      return { tacticId, selectedSeconds: usage.selectedSeconds, contactSeconds: usage.contactSeconds, score: score + progressScore, baseScore: score, stateChange, progressScore,
        startSelfMargin: usage.startSelfMargin, endSelfMargin: usage.endSelfMargin, minSelfMargin: usage.minSelfMargin,
        executed: usage.selectedSeconds >= minExecutionSeconds && score > 0 };
    }).sort((a, b) => b.score - a.score);
  }

  steerTo(target, drive, turnScale = 1) {
    const vector = { x: target.x - this.ai.x, y: target.y - this.ai.y }; const desired = Math.atan2(vector.y, vector.x); const error = angleDelta(desired - this.ai.angle);
    let forward = drive; if (Math.abs(error) > 1.75) forward *= 0.42;
    const turn = clamp(error * 1.9 * turnScale, -1, 1);
    return { left: clamp(forward - turn * 0.82, -1, 1), right: clamp(forward + turn * 0.82, -1, 1) };
  }

  safetyCorrectControl(baseControl) {
    const margin = this.footprintMargin(this.ai);
    const opponentMargin = this.footprintMargin(this.player);
    const outwardSpeed = this.radialOutwardSpeed(this.ai);
    const radial = norm({ x: this.ai.x, y: this.ai.y });
    const relativeOutward = dot({ x: this.player.vx - this.ai.vx, y: this.player.vy - this.ai.vy }, radial);
    const contact = Boolean(contactManifold(this.player, this.ai));
    const attackAdvantage = opponentMargin + 15 < margin && relativeOutward < 8;
    const emergency = margin < 12;
    const dangerousContact = contact && margin < 43 && (outwardSpeed > 5 || relativeOutward > 10);
    const dangerousTravel = outwardSpeed > 20 && margin < 43;
    if (!emergency && !dangerousContact && !dangerousTravel) {
      this.safetyState = { mode: 'attack', margin, outwardSpeed, relativeOutward };
      return baseControl;
    }
    if (!emergency && attackAdvantage && margin >= 26 && !dangerousContact) {
      this.safetyState = { mode: 'attack-advantage', margin, outwardSpeed, relativeOutward };
      return baseControl;
    }
    const inwardTarget = { x: this.ai.x - radial.x * 150, y: this.ai.y - radial.y * 150 };
    const inwardFacing = dot(forwardOf(this.ai), { x: -radial.x, y: -radial.y });
    const inwardControl = emergency && inwardFacing < 0.2
      ? { left: -1, right: -1 }
      : this.steerTo(inwardTarget, emergency ? 1 : 0.78, emergency ? 1.55 : 1.28);
    const blend = emergency ? 1 : clamp((43 - margin) / 25 + Math.max(0, outwardSpeed - 8) / 45, 0.28, 0.82);
    this.safetyState = { mode: emergency ? 'emergency' : 'correcting', margin, outwardSpeed, relativeOutward, blend };
    return {
      left: clamp(baseControl.left * (1 - blend) + inwardControl.left * blend, -1, 1),
      right: clamp(baseControl.right * (1 - blend) + inwardControl.right * blend, -1, 1)
    };
  }

  controlForTactic() {
    const tactic = this.aiState.tactics[this.tacticId] || this.aiState.tactics.direct; const player = this.player; const ai = this.ai; const d = dist(ai, player);
    const toPlayer = norm({ x: player.x - ai.x, y: player.y - ai.y }); const side = { x: -toPlayer.y * this.flankSide, y: toPlayer.x * this.flankSide };
    const phase = this.time - this.tacticStartedAt;
    const executionTime = clamp(tactic.params.executionTime ?? tacticById(this.tacticId).defaultParams.executionTime, 0.45, 1.6);
    const wiggle = Math.sin(this.time * (5.2 + tactic.params.turnBias * 2)) * (30 + tactic.params.turnBias * 42);
    let target = { x: player.x, y: player.y }; let drive = tactic.params.aggression; let turnScale = 1;
    const enemyForward = forwardOf(player);
    if (this.tacticId === 'escape') {
      const inward = norm({ x: -ai.x, y: -ai.y });
      const contactRisk = d < 86 || Math.hypot(player.vx, player.vy) > 45;
      const opponentAway = norm({ x: ai.x - player.x, y: ai.y - player.y });
      const escapeVector = contactRisk
        ? norm({ x: inward.x * 0.72 + opponentAway.x * 0.58, y: inward.y * 0.72 + opponentAway.y * 0.58 })
        : inward;
      const severity = clamp((38 - this.footprintMargin(ai)) / 38, 0, 1);
      target = { x: ai.x + escapeVector.x * (150 + severity * 70), y: ai.y + escapeVector.y * (150 + severity * 70) };
      drive = 0.92 + severity * 0.08; turnScale = 1.48 + severity * 0.22;
    } else if (this.tacticId === 'reposition') { target = { x: -ai.x * 1.8, y: -ai.y * 1.8 }; drive = -0.55; turnScale = 0.8;
    } else if (this.tacticId === 'zigzag') {
      const prediction = this.opponentPrediction();
      const retreatLead = prediction.retreatConfidence > 0.18 ? prediction.predicted : { x: player.x - enemyForward.x * (70 + tactic.params.preferredDistance * 0.1), y: player.y - enemyForward.y * (70 + tactic.params.preferredDistance * 0.1) };
      const lateralLead = prediction.turnConfidence > 0.16 ? prediction.lateralMomentum * prediction.horizon * 0.16 : 0;
      target = { x: retreatLead.x + side.x * (wiggle + lateralLead), y: retreatLead.y + side.y * (wiggle + lateralLead) };
      drive = prediction.retreatConfidence > 0.35 ? 0.92 : 0.84; turnScale = prediction.turnConfidence > 0.25 ? 1.16 : 1.05;
    } else if (this.tacticId === 'flank') {
      target = { x: player.x + side.x * (72 + tactic.params.preferredDistance * 0.08), y: player.y + side.y * (72 + tactic.params.preferredDistance * 0.08) }; drive = 0.73; turnScale = 1.18;
    } else if (this.tacticId === 'diagonal') {
      target = { x: player.x + side.x * 64 + toPlayer.x * 22, y: player.y + side.y * 64 + toPlayer.y * 22 }; drive = 0.82; turnScale = 1.12;
    } else if (this.tacticId === 'doubleZigzag') {
      const secondPhase = phase > executionTime * 0.44; const secondSide = secondPhase ? -this.flankSide : this.flankSide; const second = { x: -toPlayer.y * secondSide, y: toPlayer.x * secondSide };
      target = { x: player.x + second.x * (secondPhase ? 42 : 78), y: player.y + second.y * (secondPhase ? 42 : 78) }; drive = secondPhase ? 0.92 : 0.7; turnScale = 1.34;
    } else if (this.tacticId === 'counter') {
      // toPlayer points from the AI toward the player, so negative momentum means approach.
      const incoming = dot({ x: player.vx, y: player.vy }, toPlayer) < -22 || this.opening.placement === 'edge';
      if (phase < executionTime * 0.76 && !incoming) { target = { x: ai.x + side.x * 50, y: ai.y + side.y * 50 }; drive = 0.05; turnScale = 1.35; }
      else if (phase < executionTime * 0.72) { target = { x: ai.x + side.x * 100 - toPlayer.x * 40, y: ai.y + side.y * 100 - toPlayer.y * 40 }; drive = -0.42; turnScale = 1.2; }
      else { target = { x: player.x + side.x * 24, y: player.y + side.y * 24 }; drive = 0.94; turnScale = 1.2; }
    } else {
      target = { x: player.x + toPlayer.x * 8, y: player.y + toPlayer.y * 8 }; drive = 0.84 + tactic.params.aggression * 0.16; turnScale = 1.08;
    }
    const tacticDefaults = tacticById(this.tacticId).defaultParams;
    const defaultAggression = tacticDefaults.aggression;
    drive = clamp(drive * tactic.params.aggression / defaultAggression, -1, 1);
    turnScale *= clamp(1 + (tactic.params.turnBias - tacticDefaults.turnBias) * 0.5, 0.75, 1.25);
    if (d < 65 && this.tacticId !== 'escape' && this.tacticId !== 'counter') drive = Math.max(drive, 0.7);
    return this.safetyCorrectControl(this.steerTo(target, drive, turnScale));
  }

  classifyFailure(winner) {
    const aiEdge = Math.hypot(this.ai.x, this.ai.y); const opponentPattern = this.inferOpponentPattern();
    if (winner === 'ai') return opponentPattern === 'retreat' ? 'clean-read' : 'pressure-success';
    if (aiEdge > 165) return 'edge-risk';
    if (opponentPattern === 'retreat') return 'opponent-retreat';
    if (Math.abs(this.player.omega) > 1.25 && ['zigzag', 'doubleZigzag', 'diagonal'].includes(this.tacticId)) return 'late-turn';
    return 'read-miss';
  }

  keepTrails() { [this.player, this.ai].forEach((unit) => { unit.trail.push({ x: unit.x, y: unit.y }); if (unit.trail.length > 10) unit.trail.shift(); }); }

  finish(winner, reason, ringOut = {}) {
    if (this.ended) return; this.ended = true; this.running = false; if (this.frame) cancelAnimationFrame(this.frame); this.draw();
    const finalTactic = tacticById(this.tacticId || 'direct');
    const tacticUsage = this.evaluateTacticUsage();
    const evaluatedTactic = tacticUsage.find((usage) => usage.executed);
    this.onFinish?.({ winner, reason, aiOut: Boolean(ringOut.aiOut), playerOut: Boolean(ringOut.playerOut), aiOutMargin: this.footprintMargin(this.ai), playerOutMargin: this.footprintMargin(this.player), lastSafetyMode: this.safetyState?.mode || 'unknown',
      tacticBeforeRingOut: finalTactic.id, tacticId: finalTactic.id, tacticName: finalTactic.name, learningTacticId: evaluatedTactic?.tacticId || null,
      tacticUsage, time: this.time, distance: dist(this.player, this.ai), selfEdge: Math.hypot(this.ai.x, this.ai.y), opponentEdge: Math.hypot(this.player.x, this.player.y),
      usedTactics: [...this.usedTactics], opening: this.opening, opponentTactic: this.inferOpponentPattern(), failureCause: this.classifyFailure(winner) });
  }

  draw() {
    const ctx = this.ctx; const w = this.width; const h = this.height; const centerX = w / 2; const centerY = h / 2;
    const scale = Math.min((w - 38) / (ARENA_RADIUS * 2 + 44), (h - 28) / (ARENA_RADIUS * 2 + 44)); ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(centerX, centerY); ctx.scale(scale, scale);
    this.drawArena(ctx); this.drawTrail(ctx, this.player); this.drawTrail(ctx, this.ai); this.drawRobot(ctx, this.player, this.sprites?.player); this.drawRobot(ctx, this.ai, this.sprites?.ai); ctx.restore();
    if (this.countdown > 0 && !this.ended) { ctx.save(); ctx.fillStyle = 'rgba(7, 12, 19, .38)'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 62px system-ui, sans-serif'; ctx.fillStyle = '#fff2bf'; ctx.shadowColor = 'rgba(255,176,74,.7)'; ctx.shadowBlur = 22; ctx.fillText(this.countdown > 0.5 ? Math.ceil(this.countdown).toString() : 'GO', centerX, centerY); ctx.restore(); }
  }

  drawArena(ctx) {
    const gradient = ctx.createRadialGradient(0, -28, 30, 0, 0, ARENA_RADIUS + 25); gradient.addColorStop(0, '#263847'); gradient.addColorStop(0.7, '#172530'); gradient.addColorStop(1, '#101821');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS + 16, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(82,214,197,.32)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#1e2d38'; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS, 0, TAU); ctx.fill(); ctx.strokeStyle = '#d6b56a'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.setLineDash([4, 7]); ctx.strokeStyle = 'rgba(255,244,197,.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS - 22, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,244,197,.1)'; ctx.beginPath(); ctx.moveTo(-ARENA_RADIUS, 0); ctx.lineTo(ARENA_RADIUS, 0); ctx.moveTo(0, -ARENA_RADIUS); ctx.lineTo(0, ARENA_RADIUS); ctx.stroke(); ctx.fillStyle = 'rgba(255,176,74,.78)'; ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, TAU); ctx.fill();
  }

  drawTrail(ctx, unit) {
    unit.trail.forEach((point, index) => { const alpha = (index / unit.trail.length) * 0.12; ctx.globalAlpha = alpha; ctx.fillStyle = unit.color; ctx.beginPath(); ctx.arc(point.x, point.y, 4 + index * 0.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; });
  }

  drawRobot(ctx, unit, sprite) {
    ctx.save(); ctx.translate(unit.x, unit.y); ctx.rotate(unit.angle);
    if (sprite?.complete && sprite.naturalWidth > 0) {
      // Generated overhead sprite places the blade at image-bottom; align it with +X forward.
      ctx.rotate(-Math.PI / 2); ctx.shadowColor = unit.color; ctx.shadowBlur = 7; ctx.drawImage(sprite, -25, -37, 50, 74);
    } else this.drawRobotFallback(ctx, unit);
    ctx.restore();
    ctx.fillStyle = 'rgba(240,248,255,.84)'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(unit.name, unit.x, unit.y - 39);
  }

  drawRobotFallback(ctx, unit) {
    const body = new Path2D();
    body.moveTo(31, -10); body.lineTo(26, -21); body.lineTo(18, -23); body.lineTo(-24, -23); body.lineTo(-28, -18);
    body.lineTo(-28, 18); body.lineTo(-24, 23); body.lineTo(18, 23); body.lineTo(26, 21); body.lineTo(31, 10); body.closePath();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    const hull = ctx.createLinearGradient(-18, -23, 15, 23); hull.addColorStop(0, '#d4d9d6'); hull.addColorStop(0.24, unit.color); hull.addColorStop(1, '#303a42');
    ctx.fillStyle = hull; ctx.fill(body); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#e8ece7'; ctx.lineWidth = 1.6; ctx.stroke(body);

    // Ground-skimming stainless blade, faceted bevels and attachment bolts.
    ctx.fillStyle = '#aeb9bd'; ctx.strokeStyle = '#f0f2ed'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(17, -21); ctx.lineTo(31, -10); ctx.lineTo(33, -7); ctx.lineTo(33, 7); ctx.lineTo(31, 10); ctx.lineTo(17, 21); ctx.lineTo(20, 11); ctx.lineTo(20, -11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(21, -17); ctx.lineTo(29, -9); ctx.moveTo(21, 17); ctx.lineTo(29, 9); ctx.stroke();
    [-15, 15].forEach((y) => { ctx.fillStyle = '#29343b'; ctx.beginPath(); ctx.arc(18, y, 1.8, 0, TAU); ctx.fill(); ctx.fillStyle = '#f3ead2'; ctx.beginPath(); ctx.arc(18, y, 0.7, 0, TAU); ctx.fill(); });

    // Side drive wheels with rubber tread, metal hubs and visible wheel guards.
    [-1, 1].forEach((side) => {
      const y = side * 17;
      ctx.fillStyle = '#11171b'; ctx.strokeStyle = '#727d80'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.roundRect(-8, y - 5.4, 24, 10.8, 3.2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(197,208,203,.62)'; ctx.lineWidth = 0.75;
      for (let i = -5; i <= 12; i += 4) { ctx.beginPath(); ctx.moveTo(i, y - 4.3); ctx.lineTo(i + 2, y + 4.3); ctx.stroke(); }
      ctx.fillStyle = '#77858a'; ctx.fillRect(0, y - 2.2, 7, 4.4); ctx.fillStyle = unit.accent; ctx.fillRect(2, y - 1, 3, 2);
    });

    // Electronics deck, battery, motor caps, traces and wiring keep the top view legible.
    ctx.fillStyle = 'rgba(9,17,23,.92)'; ctx.strokeStyle = 'rgba(235,240,231,.72)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.roundRect(-13, -13, 25, 26, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#477d68'; ctx.beginPath(); ctx.roundRect(-10, -10, 18, 20, 2); ctx.fill();
    ctx.strokeStyle = '#c99253'; ctx.lineWidth = 0.8;
    [[-7,-7],[-2,-7],[4,-7],[-7,7],[-2,7],[4,7]].forEach(([x,y]) => { ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+3,y); ctx.lineTo(x+3,y+(y<0?3:-3)); ctx.stroke(); });
    ctx.fillStyle = '#d8d9ca'; ctx.fillRect(-3, -3, 6, 6); ctx.fillStyle = '#26333b'; ctx.fillRect(-1.5, -1.5, 3, 3);
    ctx.strokeStyle = unit.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-11, -5); ctx.bezierCurveTo(-19, -5, -19, -13, -12, -15); ctx.moveTo(-11, 5); ctx.bezierCurveTo(-20, 7, -17, 14, -10, 15); ctx.stroke();
    ctx.fillStyle = '#243039'; ctx.strokeStyle = '#a4afb0'; ctx.lineWidth = 0.8;
    [-19, 19].forEach((y) => { ctx.beginPath(); ctx.roundRect(-17, y - 2.6, 25, 5.2, 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#5f696b'; ctx.beginPath(); ctx.arc(-12, y, 1.7, 0, TAU); ctx.fill(); ctx.fillStyle = '#243039'; });
    [[-21,-16],[12,-16],[-21,16],[12,16]].forEach(([x,y]) => { ctx.fillStyle = '#202a30'; ctx.beginPath(); ctx.arc(x,y,2.2,0,TAU); ctx.fill(); ctx.fillStyle = '#c6c9be'; ctx.fillRect(x-1.1,y-.45,2.2,.9); });
    ctx.fillStyle = unit.accent; ctx.beginPath(); ctx.moveTo(-18, -3); ctx.lineTo(-12, 0); ctx.lineTo(-18, 3); ctx.closePath(); ctx.fill();
  }
}

export { ARENA_RADIUS, ROBOT_RADIUS, FOOTPRINT, contactManifold };
