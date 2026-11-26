import { TACTICS, tacticById, recordTacticSelection } from './data.js';

// ---------------------------------------------------------------------------
// World units: 1 unit ≈ 1.75 mm (dohyo radius 220 ≈ 385 mm). The game world is
// time-scaled, so tyre grip is expressed directly as μ·g in units/s² per unit mass.
// Robot body is 100mm × 100mm square (exactly).
// ---------------------------------------------------------------------------
const ARENA_RADIUS = 220;
const ROBOT_RADIUS = 32; // Exported for backward compatibility; actual shape is FOOTPRINT square
// Exact: 100mm body / 2 = 50mm half-size / 1.75mm per unit = 28.571428... units
// Using full precision to maintain exact 100mm × 100mm dimension.
// Rounded for readability: 28.57 (29 would give 101.5mm, deviating from spec).
const ROBOT_HALF_SIZE = 28.57142857142857; // 50/1.75 exact; 28.57 is adequate approximation
const MAX_SPEED = 142;
const TURN_SPEED = 3.6;
const DRIVE_ACCEL = 390;          // motor current limit (stall force per unit mass, both wheels)
const MOTOR_GAIN = 4.5;           // slope of the DC-motor torque–speed line
const WHEEL_HALF_TRACK = 15;      // wheel distance from the centre line
const WHEEL_AXLE_X = 4;           // axle position along the body (local +x is forward)
const BODY_INERTIA = 260;       // inertia for 100mm×100mm square robot (kg·mm² → units²)
// Torque-speed balance settings per machine (0=torque focus, 100=speed focus)
const TORQUE_SPEED_PRESET_MAX_SPEED = [136, 149.6, 170, 190.4, 204];
const TORQUE_SPEED_PRESET_DRIVE_ACCEL = [537.5, 488.6, 430, 383.9, 358.3];
const TORQUE_SPEED_POINTS_S = [0, 25, 50, 75, 100];
// ---------------------------------------------------------------------------
const CONTACT_SLOP = 0.32;
const GRIP_ACCEL = 470;           // μ·g at static load (μ = 1 → effective g = 470 units/s²)
const LATERAL_STIFFNESS = 0.9;    // share of lateral slip a gripping tyre cancels each step
const BLADE_LIFT = 0.55;          // effective tanθ of a blade wedge that gets under the opponent
const ROLLING_DRAG = 0.28;
const YAW_DRAG = 1.15;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const norm = (v) => { const length = Math.hypot(v.x, v.y) || 1; return { x: v.x / length, y: v.y / length }; };
const angleDelta = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smoothstep = (edge0, edge1, x) => { const t = clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };
const ema = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));
const interpolateMotorParams = (torqueSpeed) => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (torqueSpeed <= TORQUE_SPEED_POINTS_S[0]) return { maxSpeed: TORQUE_SPEED_PRESET_MAX_SPEED[0], driveAccel: TORQUE_SPEED_PRESET_DRIVE_ACCEL[0] };
  if (torqueSpeed >= TORQUE_SPEED_POINTS_S[TORQUE_SPEED_POINTS_S.length - 1]) {
    return { maxSpeed: TORQUE_SPEED_PRESET_MAX_SPEED[TORQUE_SPEED_PRESET_MAX_SPEED.length - 1], driveAccel: TORQUE_SPEED_PRESET_DRIVE_ACCEL[TORQUE_SPEED_PRESET_DRIVE_ACCEL.length - 1] };
  }
  // Find the interval
  for (let i = 0; i < TORQUE_SPEED_POINTS_S.length - 1; i += 1) {
    if (torqueSpeed >= TORQUE_SPEED_POINTS_S[i] && torqueSpeed <= TORQUE_SPEED_POINTS_S[i + 1]) {
      const t = (torqueSpeed - TORQUE_SPEED_POINTS_S[i]) / (TORQUE_SPEED_POINTS_S[i + 1] - TORQUE_SPEED_POINTS_S[i]);
      // Smoothstep for smooth interpolation
      const t2 = t * t * (3 - 2 * t);
      const maxSpeed = TORQUE_SPEED_PRESET_MAX_SPEED[i] * (1 - t2) + TORQUE_SPEED_PRESET_MAX_SPEED[i + 1] * t2;
      const driveAccel = TORQUE_SPEED_PRESET_DRIVE_ACCEL[i] * (1 - t2) + TORQUE_SPEED_PRESET_DRIVE_ACCEL[i + 1] * t2;
      return { maxSpeed, driveAccel };
    }
  }
  // Fallback (should not reach here)
  return { maxSpeed: MAX_SPEED, driveAccel: DRIVE_ACCEL };
};
const forwardOf = (unit) => ({ x: Math.cos(unit.angle), y: Math.sin(unit.angle) });
// The canvas y axis points down, so this vector is the robot's RIGHT-hand side.
const sideOf = (unit) => { const f = forwardOf(unit); return { x: -f.y, y: f.x }; };
const toLocal = (unit, point) => { const f = forwardOf(unit); const s = sideOf(unit); const r = { x: point.x - unit.x, y: point.y - unit.y }; return { x: dot(r, f), y: dot(r, s) }; };

// Convex footprint: the shallow forward shoulders and broad blade are part of the
// collision shape, rather than an invisible circle around the robot's center.
// Updated to 100mm × 100mm square: ~57 units wide/tall, half-size ~29 units.
const FOOTPRINT = [
  { x: -ROBOT_HALF_SIZE, y: -ROBOT_HALF_SIZE }, { x: ROBOT_HALF_SIZE, y: -ROBOT_HALF_SIZE },
  { x: ROBOT_HALF_SIZE, y: ROBOT_HALF_SIZE }, { x: -ROBOT_HALF_SIZE, y: ROBOT_HALF_SIZE }
];

function robot(x, y, angle, color, accent, name, sprite) {
  return { x, y, angle, color, accent, name, sprite, vx: 0, vy: 0, omega: 0,
    left: 0, right: 0, drivePower: 1, mass: 1, inertia: BODY_INERTIA, loadFactor: 1, wheelSlip: 0, trail: [] };
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

// How squarely a robot's blade meets the contact: 1 = the blade edge is the part
// touching AND it faces the opponent, 0 = the contact is on the side/back panels.
function bladeEngagement(unit, point, towardOther) {
  const local = toLocal(unit, point);
  const onBlade = smoothstep(12, 22, local.x);
  const facing = clamp((dot(forwardOf(unit), towardOther) - 0.25) / 0.5, 0, 1);
  return onBlade * facing;
}

function relaxLoad(unit, dt) { unit.loadFactor = ema(unit.loadFactor ?? 1, 1, dt, 0.06); }
function steerLoad(unit, target, dt) { unit.loadFactor = ema(unit.loadFactor ?? 1, clamp(target, 0.25, 1.75), dt, 0.04); }

const NO_CONTACT = Object.freeze({ touching: false, force: 0, wedgePlayer: 0, wedgeAI: 0, normal: { x: 0, y: 0 }, point: null });

export class BattleSimulation {
  constructor(canvas, aiState, { onUpdate, onFinish, sprites = {}, random = null, setup = 'standard', torqueSpeed = 50, aiTorqueSpeed = 50 } = {}) {
    this.canvas = canvas; this.ctx = canvas?.getContext?.('2d') || null; this.aiState = aiState;
    this.onUpdate = onUpdate; this.onFinish = onFinish; this.running = false; this.ended = false; this.paused = false;
    this.random = random;
    this.frame = 0; this.lastTime = 0; this.time = 0; this.countdown = 3.1; this.aiDecisionTimer = 0;
    this.tacticId = ''; this.tacticStartedAt = 0; this.tacticLockUntil = 0; this.flankSide = this.rand() > 0.5 ? 1 : -1;
    this.usedTactics = new Set(); this.tacticHistory = []; this.tacticUsage = {}; this.input = { left: 0, right: 0 };
    this.width = 620; this.height = 620;
// Normalize torqueSpeed: clamp 0-100, handle NaN/Infinity/null
    // - 0 is a valid setting (torque-focused)
    // - Infinity/NaN/null → default 50
    // - Out-of-range values → clamped to 0-100
    // - Numerical strings are converted; non-numerical → 50
    if (torqueSpeed === null || torqueSpeed === undefined) {
      this.torqueSpeed = 50;
    } else if (Number.isFinite(torqueSpeed)) {
      this.torqueSpeed = Math.max(0, Math.min(100, torqueSpeed));
    } else {
      // NaN, Infinity, non-numeric string, etc.
      this.torqueSpeed = 50;
    }
    // AI torqueSpeed: always use default, player-controllable setting is separate
    if (aiTorqueSpeed === null || aiTorqueSpeed === undefined) {
      this.aiTorqueSpeed = 50;
    } else if (Number.isFinite(aiTorqueSpeed)) {
      this.aiTorqueSpeed = Math.max(0, Math.min(100, aiTorqueSpeed));
    } else {
      // NaN, Infinity, non-numeric string, etc.
      this.aiTorqueSpeed = 50;
    }
    const start = BattleSimulation.startPositions(setup, () => this.rand());
    this.player = robot(start.player.x, start.player.y, start.player.angle, '#ffb04a', '#fff2bf', 'YOU', sprites.player || null);
    this.ai = robot(start.ai.x, start.ai.y, start.ai.angle, '#52d6c5', '#d9fff7', 'KOMA', sprites.ai || null);
    this.sprites = { player: this.loadSprite(this.player.sprite), ai: this.loadSprite(this.ai.sprite) };
    this.ensureRuntime();
    this.opening = this.analyzeOpening(); if (this.canvas) this.resize();
  }

  // Symmetric start setups: both robots always get mirrored placements, so the
  // opening never favours one side.
  static startPositions(setup, rand = Math.random) {
    if (setup !== 'random') return { player: { x: -112, y: 0, angle: 0 }, ai: { x: 112, y: 0, angle: Math.PI } };
    const offsetY = (rand() - 0.5) * 70; const spread = 96 + rand() * 40;
const yawPlayer = (rand() - 0.5) * 1.6; const yawAI = (rand() - 0.5) * 1.6;
    return { player: { x: -spread, y: offsetY, angle: yawPlayer }, ai: { x: spread, y: -offsetY, angle: Math.PI + yawAI } };
  }

  static createHeadless(aiState, options = {}) { return new BattleSimulation(null, aiState, { ...options }); }

  rand() { return (this.random || Math.random)(); }

  // Objects created via Object.create in tests and older harnesses may lack the
  // runtime fields added after the third improvement, so they are filled lazily.
  ensureRuntime() {
    this.contact ||= NO_CONTACT; this.contactForce ??= 0;
    this.pressure ||= { x: 0, y: 0, side: 0, rear: 0, front: 0 };
    this.frontalLoss ??= 0; this.sidePressureTimer ??= 0; this.frontalLossTimer ??= 0;
    this.tacticMemory ||= {}; this.styleSamples ||= {}; this.openingMove ??= null;
    this.openingTrack ||= null; this.events ||= { sideHitSeconds: 0, sidePressureSeconds: 0, frontalLossSeconds: 0, pivotRecoveries: 0, sideEpisodes: 0 };
    this.tacticLatch ||= {};
    for (const unit of [this.player, this.ai]) { if (unit) { unit.loadFactor ??= 1; unit.wheelSlip ??= 0; } }
  }

  loadSprite(source) {
    if (typeof Image === 'undefined' || !source) return null;
    const image = new Image(); image.decoding = 'async'; image.src = source; return image;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(240, rect.width || 620); this.height = Math.max(240, rect.height || 440);
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
    // Learned opening habits of the (single) human opponent are blended with the
    // geometric prior. A Beta-like prior keeps a few matches from dominating.
    const model = this.aiState?.opponentModel?.openings || {};
    const total = Object.values(model).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const prior = { charge: cornerAdvantage ? 0.2 : 0.35, retreat: likelyOpponentResponses.includes('retreat') ? 0.35 : 0.15, turn: 0.2, wait: 0.3 };
    const opponentOpeningProbs = {};
    for (const key of Object.keys(prior)) opponentOpeningProbs[key] = ((Number(model[key]) || 0) + prior[key] * 3) / (total + 3);
    if (total >= 3 && opponentOpeningProbs.retreat > 0.4 && !likelyOpponentResponses.includes('retreat')) likelyOpponentResponses.push('retreat');
    if (total >= 3 && opponentOpeningProbs.charge > 0.45) likelyOpponentResponses.push('direct');
    if (!likelyOpponentResponses.length) likelyOpponentResponses.push('direct');
    return {
      placement, distance, selfEdge, opponentEdge, edgeClearance, opponentClearance, freeSpace,
      selfBearing, opponentBearing, bladeAdvantage, cornerAdvantage, likelyOpponentResponses, opponentOpeningProbs, learnedOpenings: total,
      space: freeSpace > 0.58 ? 'open' : freeSpace < 0.28 ? 'tight' : 'usable'
    };
  }

  setInput(side, value) { this.input[side] = clamp(Number(value) || 0, -1, 1); }
  releaseInputs() { this.input.left = 0; this.input.right = 0; }
  start() { this.running = true; this.paused = false; this.lastTime = performance.now(); this.selectTactic(true); this.frame = requestAnimationFrame((next) => this.loop(next)); }
  stop() { this.running = false; this.releaseInputs(); if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame); }
  pause() { if (this.ended) return; this.paused = true; this.releaseInputs(); this.draw(); }
  resume() { if (!this.paused) return; this.paused = false; this.lastTime = performance.now(); }

  loop(timestamp) {
    if (!this.running) return;
    const dt = Math.min(0.034, Math.max(0.001, (timestamp - this.lastTime) / 1000)); this.lastTime = timestamp;
    if (!this.ended && !this.paused) {
      // Fixed 1/120 s physics substeps keep contact and friction independent of the display rate.
      this.accumulator = (this.accumulator || 0) + dt;
      while (this.accumulator >= 1 / 120 && !this.ended) {
        const step = 1 / 120; this.accumulator -= step;
        if (this.countdown > 0) this.countdown -= step; else { this.time += step; this.update(step); }
      }
      this.draw(); this.onUpdate?.(this.snapshot());
    }
    this.frame = requestAnimationFrame((next) => this.loop(next));
  }

  // Advances one fixed step without rendering (used by tests and headless evaluation).
  step(dt = 1 / 120) {
    if (this.ended) return;
    if (this.countdown > 0) { this.countdown -= dt; return; }
    this.time += dt; this.update(dt);
  }

  snapshot() {
    const tactic = tacticById(this.tacticId || 'direct');
    return { countdown: Math.max(0, this.countdown), time: this.time, tacticName: tactic.name, tacticId: tactic.id,
      playerEdge: Math.round(Math.hypot(this.player.x, this.player.y)), aiEdge: Math.round(Math.hypot(this.ai.x, this.ai.y)),
      playerMargin: Math.round(this.footprintMargin(this.player)), aiMargin: Math.round(this.footprintMargin(this.ai)),
      distance: Math.round(dist(this.player, this.ai)), placement: this.opening.placement, bladeAdvantage: this.opening.bladeAdvantage,
      situation: this.situationLabel(), touching: this.contact.touching, paused: this.paused };
  }

  situationLabel() {
    const s = this.lastSituation; if (!s) return '様子見';
    if (s.selfMargin < 30) return '土俵際';
    if (s.sidePressure > 0.22) return '横から押されている';
    if (s.rearPressure > 0.3) return '後ろから押されている';
    if (s.frontalLoss > 10) return '正面で押し負け';
    if (s.touching && s.aiOnOpponentFlank) return '相手の側面を押している';
    if (s.touching && s.frontalContest) return '正面で押し合い';
    if (s.touching) return '接触中';
    return s.distance < 140 ? '接近' : '間合い';
  }

  update(dt) {
    this.ensureRuntime();
    this.aiDecisionTimer -= dt;
    if (this.aiDecisionTimer <= 0) { this.selectTactic(false); this.aiDecisionTimer = 0.34 + this.rand() * 0.18; }
    const aiControl = this.controlForTactic();
    this.player.left = this.input.left; this.player.right = this.input.right;
    this.ai.left = aiControl.left; this.ai.right = aiControl.right;
    this.applyDrive(this.player, dt); this.applyDrive(this.ai, dt);
    const touching = this.resolveRobotCollision(dt);
    this.trackSituation(dt);
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
      const s = this.lastSituation;
      if (s) {
        usage.sideHitSeconds = (usage.sideHitSeconds || 0) + (s.touching && s.aiOnOpponentFlank ? dt : 0);
        usage.sidePressureSeconds = (usage.sidePressureSeconds || 0) + (s.sidePressure > 0.22 ? dt : 0);
        usage.frontalLossSeconds = (usage.frontalLossSeconds || 0) + (s.frontalLoss > 10 ? dt : 0);
        if (this.tacticId === 'pivot' && usage.startedUnderPressure && s.sidePressure < 0.1 && Math.abs(s.bearing) < 0.65 && usage.endSelfMargin > usage.startSelfMargin - 20) usage.recovered = true;
        if (this.tacticId === 'sidestep' && usage.startedLosing && !s.touching && s.frontalLoss < 4 && usage.endSelfMargin > usage.startSelfMargin - 15) usage.recovered = true;
      }
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

  // Continuous state the AI reads: contact pressure in its own body frame, the
  // frontal push contest, opponent style samples and the opening move.
  trackSituation(dt) {
    const ai = this.ai; const c = this.contact;
    const fA = forwardOf(ai); const sA = sideOf(ai);
    let fx = 0; let fy = 0;
    if (c.touching) { fx = dot(c.normal, fA) * c.force; fy = dot(c.normal, sA) * c.force; }
    const p = this.pressure;
    p.x = ema(p.x, fx, dt, 0.12); p.y = ema(p.y, fy, dt, 0.12);
    const magnitude = Math.hypot(p.x, p.y);
    // Pressure relative to what the AI's own tyres can hold sideways.
    const scale = GRIP_ACCEL * ai.mass * 0.55;
    // A side push means the opponent's force lands on the AI's side/back panels,
    // not on its own blade (an angled blade-to-blade shove is a frontal contest).
    this.offBladeContact = ema(this.offBladeContact ?? 0, c.touching ? 1 - c.wedgeAI : 0, dt, 0.08);
    const offBlade = clamp((this.offBladeContact - 0.4) / 0.35, 0, 1);
    p.side = magnitude > 20 ? clamp(Math.abs(p.y) / scale, 0, 1.5) * (Math.abs(p.y) > Math.abs(p.x) * 0.7 ? 1 : 0.4) * offBlade : 0;
    p.rear = clamp(p.x / scale, 0, 1.5) * offBlade;
    p.front = clamp(-p.x / scale, 0, 1.5);
    const vLong = dot({ x: ai.vx, y: ai.vy }, fA);
    const frontal = c.touching && c.wedgeAI > 0.45 && c.wedgePlayer > 0.45;
    // Only a genuine shove counts: evasive tactics deliberately give ground.
    const pushingForward = (ai.left + ai.right) > 1.2 && !['sidestep', 'pivot', 'reposition'].includes(this.tacticId);
    // Losing a shove = being driven backward, or being moved toward the rim while
    // the blades are locked and the AI is pushing.
    const outward = this.radialOutwardSpeed(ai);
    // Moving toward the rim only counts when the AI is not advancing — when it drives
    // the opponent out, it naturally travels outward too.
    const lossSignal = Math.max(0, -vLong, vLong < 4 ? outward * 0.8 : 0);
    this.frontalLoss = ema(this.frontalLoss, frontal && pushingForward ? lossSignal : 0, dt, frontal ? 0.18 : 0.4);
    if (this.frontalLoss > 10 && !this.inLossEpisode) { this.inLossEpisode = true; this.events.frontalLossEpisodes = (this.events.frontalLossEpisodes || 0) + 1; }
    if (this.frontalLoss < 3) this.inLossEpisode = false;
    if (frontal) this.events.frontalSeconds = (this.events.frontalSeconds || 0) + dt;
    // Head-on stalemate: blades locked and nobody making progress.
    this.frontalStall = frontal && Math.abs(vLong) < 15 ? (this.frontalStall ?? 0) + dt : 0;
    this.sidePressureTimer = p.side > 0.22 ? this.sidePressureTimer + dt : 0;
    this.frontalLossTimer = this.frontalLoss > 10 ? this.frontalLossTimer + dt : 0;
    const s = this.assessSituation();
    this.lastSituation = s;
    // React within ~0.12 s to a side push or a lost head-on contest instead of waiting for the periodic re-plan.
    if ((this.sidePressureTimer > 0.12 && this.tacticId !== 'pivot' && this.tacticId !== 'escape') ||
        (this.frontalLossTimer > 0.16 && !['sidestep', 'escape', 'pivot'].includes(this.tacticId))) this.aiDecisionTimer = Math.min(this.aiDecisionTimer, 0);
    // In-match memory: the tactic that exposed the side or lost the shove is less attractive for a while.
    for (const key of Object.keys(this.tacticMemory)) this.tacticMemory[key] = ema(this.tacticMemory[key], 0, dt, 4);
    if (this.sidePressureTimer > 0 && this.sidePressureTimer <= dt * 1.01 && this.tacticId) { this.tacticMemory[this.tacticId] = (this.tacticMemory[this.tacticId] || 0) + 0.5; this.events.sideEpisodes += 1; }
    if (this.frontalLossTimer > 0 && this.frontalLossTimer <= dt * 1.01 && this.tacticId) this.tacticMemory[this.tacticId] = (this.tacticMemory[this.tacticId] || 0) + 0.9;
    if (s.touching && s.aiOnOpponentFlank) { this.events.sideHitSeconds += dt; if (this.tacticId) this.tacticMemory[this.tacticId] = (this.tacticMemory[this.tacticId] || 0) - dt * 1.2; }
    if (p.side > 0.22) this.events.sidePressureSeconds += dt;
    if (this.frontalLoss > 10) this.events.frontalLossSeconds += dt;
    // Opponent style histogram (for matchup learning) and the opening move.
    const pattern = this.inferOpponentPattern();
    this.styleSamples[pattern] = (this.styleSamples[pattern] || 0) + dt;
    if (!this.openingTrack) this.openingTrack = { x: this.player.x, y: this.player.y, toAI: norm({ x: this.ai.x - this.player.x, y: this.ai.y - this.player.y }), turn: 0 };
    if (!this.openingMove) {
      this.openingTrack.turn += Math.abs(this.player.omega) * dt;
      if (this.time >= 1.2) {
        const along = dot({ x: this.player.x - this.openingTrack.x, y: this.player.y - this.openingTrack.y }, this.openingTrack.toAI);
        this.openingMove = along > 25 ? 'charge' : along < -18 ? 'retreat' : this.openingTrack.turn > 1.2 ? 'turn' : 'wait';
      }
    }
  }

  opponentStyle() {
    const entries = Object.entries(this.styleSamples || {});
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (total >= 1.5) return entries.sort((a, b) => b[1] - a[1])[0][0];
    const learned = Object.entries(this.aiState?.opponentModel?.styles || {}).sort((a, b) => b[1] - a[1])[0];
    return learned ? learned[0] : 'unknown';
  }

  // Everything the tactical layer needs about the current state, in one place.
  assessSituation() {
    this.ensureRuntime();
    const ai = this.ai; const player = this.player; const c = this.contact;
    const fA = forwardOf(ai); const sA = sideOf(ai); const fP = forwardOf(player);
    const toPlayer = norm({ x: player.x - ai.x, y: player.y - ai.y });
    const distance = dist(ai, player);
    const bearing = angleDelta(Math.atan2(toPlayer.y, toPlayer.x) - ai.angle);
    const opponentBearing = angleDelta(Math.atan2(-toPlayer.y, -toPlayer.x) - player.angle);
    const velocity = { x: ai.vx, y: ai.vy };
    const relativeVelocity = { x: player.vx - ai.vx, y: player.vy - ai.vy };
    const contactLocal = c.touching && c.point ? toLocal(ai, c.point) : null;
    const selfMargin = this.footprintMargin(ai); const opponentMargin = this.footprintMargin(player);
    const prediction = this.opponentPrediction();
    const p = this.pressure;
    return {
      distance, bearing, opponentBearing, toPlayer,
      selfPos: { x: ai.x, y: ai.y }, selfHeading: ai.angle, opponentPos: { x: player.x, y: player.y }, opponentHeading: player.angle,
      selfLong: dot(velocity, fA), selfSlip: dot(velocity, sA), selfOmega: ai.omega,
      opponentSpeed: Math.hypot(player.vx, player.vy), opponentOmega: player.omega,
      closingSpeed: -dot(relativeVelocity, toPlayer),
      touching: c.touching, contactLocal, contactForce: c.force, wedgeAI: c.wedgeAI, wedgePlayer: c.wedgePlayer,
      frontalContest: c.touching && c.wedgeAI > 0.45 && c.wedgePlayer > 0.45, frontalStall: this.frontalStall ?? 0,
      aiOnOpponentFlank: c.touching && c.wedgeAI > 0.45 && c.wedgePlayer < 0.3,
      opponentOnAIFlank: c.touching && c.wedgePlayer > 0.45 && c.wedgeAI < 0.3,
      opponentExposure: Math.abs(opponentBearing), facingOpponentSide: Math.abs(opponentBearing) > 1.0 && Math.abs(bearing) < 0.6,
      sidePressure: p.side, rearPressure: p.rear, frontPressure: p.front, frontalLoss: this.frontalLoss,
      selfMargin, opponentMargin, selfCenter: Math.hypot(ai.x, ai.y), opponentCenter: Math.hypot(player.x, player.y),
      selfOutward: this.radialOutwardSpeed(ai), opponentOutward: this.radialOutwardSpeed(player),
      predicted: prediction.predicted, prediction,
      opponentForward: fP
    };
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
    const s = this.lastSituation;
    return { selectedSeconds: 0, contactSeconds: 0, startDistance: distance, endDistance: distance,
      startSelfMargin: selfMargin, endSelfMargin: selfMargin, startOpponentMargin: opponentMargin,
      endOpponentMargin: opponentMargin, startAngleGap: angleGap, endAngleGap: angleGap, minSelfMargin: selfMargin,
      sideHitSeconds: 0, sidePressureSeconds: 0, frontalLossSeconds: 0,
      startedUnderPressure: Boolean(s && (s.sidePressure > 0.22 || s.rearPressure > 0.3)), startedLosing: Boolean(s && s.frontalLoss > 10), recovered: false };
  }

  // Differential drive with a tyre model:
  // - each wheel's DC motor follows its torque–speed line, limited by current;
  // - each tyre can transmit at most μ·N (N from the static weight plus any blade
  //   load transfer), shared between driving and side grip (friction circle);
  // - side grip behaves as static friction until it saturates, then the chassis slides;
  // - wheel forces at ±half-track create the yaw torque.
  // Right wheel faster than left => the robot turns LEFT (counter-clockwise on screen).
  applyDrive(unit, dt) {
    const forward = forwardOf(unit); const side = sideOf(unit);
    const mass = unit.mass ?? 1; const inertia = unit.inertia ?? BODY_INERTIA;
    const velocity = { x: unit.vx, y: unit.vy };
    const motorParams = interpolateMotorParams(unit === this.ai ? this.aiTorqueSpeed : this.torqueSpeed);
    const MAX_SPEED = motorParams.maxSpeed;
    const DRIVE_ACCEL = motorParams.driveAccel;
    const longitudinalSpeed = dot(velocity, forward);
    const lateralSpeed = dot(velocity, side);
    // Left wheel sits at local y = -half-track, right wheel at +half-track.
    const leftSpeed = longitudinalSpeed + unit.omega * WHEEL_HALF_TRACK;
    const rightSpeed = longitudinalSpeed - unit.omega * WHEEL_HALF_TRACK;
const load = clamp(unit.loadFactor ?? 1, 0.25, 1.75);
    const gripPerWheel = GRIP_ACCEL * mass * load / 2;
    const motorLimit = DRIVE_ACCEL * (unit.drivePower ?? 1) * mass / 2;
    const motor = (command, wheelSpeed) => clamp((clamp(command ?? 0, -1, 1) * MAX_SPEED - wheelSpeed) * MOTOR_GAIN * mass / 2, -motorLimit, motorLimit);
    const leftMotor = motor(unit.left, leftSpeed); const rightMotor = motor(unit.right, rightSpeed);
    const leftForce = clamp(leftMotor, -gripPerWheel, gripPerWheel);
    const rightForce = clamp(rightMotor, -gripPerWheel, gripPerWheel);
    unit.wheelSlip = Math.max(Math.abs(leftMotor) - gripPerWheel, Math.abs(rightMotor) - gripPerWheel, 0);

    // Side grip at the axle: cancel the lateral slip (static friction) within the
    // grip left over by the driving force on each tyre.
    const axleLateral = lateralSpeed + unit.omega * WHEEL_AXLE_X;
    const effectiveMass = 1 / (1 / mass + (WHEEL_AXLE_X * WHEEL_AXLE_X) / inertia);
    const lateralAvailable = Math.sqrt(Math.max(0, gripPerWheel ** 2 - leftForce ** 2)) + Math.sqrt(Math.max(0, gripPerWheel ** 2 - rightForce ** 2));
    const lateralForce = clamp(-axleLateral * effectiveMass * LATERAL_STIFFNESS / dt, -lateralAvailable, lateralAvailable);
    unit.lateralSaturation = lateralAvailable > 0 ? Math.abs(lateralForce) / lateralAvailable : 1;

    const drive = leftForce + rightForce;
    unit.vx += (forward.x * drive + side.x * lateralForce) / mass * dt;
    unit.vy += (forward.y * drive + side.y * lateralForce) / mass * dt;
    const torque = WHEEL_HALF_TRACK * (leftForce - rightForce) + WHEEL_AXLE_X * lateralForce;
    unit.omega += torque / inertia * dt;

    unit.vx *= Math.exp(-ROLLING_DRAG * dt); unit.vy *= Math.exp(-ROLLING_DRAG * dt);
    unit.omega *= Math.exp(-YAW_DRAG * dt);
    const maxOmega = TURN_SPEED * 1.28;
    unit.omega = clamp(unit.omega, -maxOmega, maxOmega);
    const speed = Math.hypot(unit.vx, unit.vy);
    if (speed > MAX_SPEED) { unit.vx *= MAX_SPEED / speed; unit.vy *= MAX_SPEED / speed; }
    unit.angle = (unit.angle + unit.omega * dt + TAU) % TAU;
    unit.x += unit.vx * dt; unit.y += unit.vy * dt;
  }

  resolveRobotCollision(dt = 1 / 60) {
    this.ensureRuntime();
    const a = this.player; const b = this.ai; const manifold = contactManifold(a, b);
    if (!manifold) {
      relaxLoad(a, dt); relaxLoad(b, dt);
      this.contactForce = ema(this.contactForce, 0, dt, 0.05);
      this.contact = NO_CONTACT;
      return false;
    }
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
    let normalImpulseMagnitude = 0;
    if (normalSpeed < 0 && normalDenominator > 0) {
      normalImpulseMagnitude = -(1 + 0.035) * normalSpeed / normalDenominator;
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

    // Blade wedge: when one robot's blade edge meets the other's side or back panel,
    // part of the contact force lifts the struck robot (less tyre load, less grip)
    // and presses the attacker down (more grip). Blade-to-blade contact cancels out.
    this.contactForce = ema(this.contactForce, normalImpulseMagnitude / dt, dt, 0.08);
    const wedgeA = bladeEngagement(a, point, normal);
    const wedgeB = bladeEngagement(b, point, { x: -normal.x, y: -normal.y });
    const liftOnB = BLADE_LIFT * this.contactForce * wedgeA * (1 - wedgeB);
    const liftOnA = BLADE_LIFT * this.contactForce * wedgeB * (1 - wedgeA);
    steerLoad(a, 1 + (liftOnB - liftOnA) / (a.mass * GRIP_ACCEL), dt);
    steerLoad(b, 1 + (liftOnA - liftOnB) / (b.mass * GRIP_ACCEL), dt);
    this.contact = { touching: true, point, normal, force: this.contactForce, wedgePlayer: wedgeA, wedgeAI: wedgeB };
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
    // Integrate the opponent's current linear and angular velocity along an arc
    // instead of a straight line, so a turning robot is led correctly.
    const predicted = { x: this.player.x, y: this.player.y };
    const forwardSpeed = dot(velocity, forwardOf(this.player)); const sideSpeed = dot(velocity, sideOf(this.player));
    let heading = this.player.angle; const steps = 6; const h = horizon / steps;
    for (let i = 0; i < steps; i += 1) {
      const f = { x: Math.cos(heading), y: Math.sin(heading) }; const s = { x: -f.y, y: f.x };
      predicted.x += (f.x * forwardSpeed + s.x * sideSpeed) * h; predicted.y += (f.y * forwardSpeed + s.y * sideSpeed) * h;
      heading += this.player.omega * h * 0.8;
    }
    const headingVector = forwardOf(this.player);
    if (awayMomentum > 0) { predicted.x += headingVector.x * 18 * retreatConfidence; predicted.y += headingVector.y * 18 * retreatConfidence; }
    // A prediction outside the ring is not reachable for the opponent without losing.
    const radius = Math.hypot(predicted.x, predicted.y);
    if (radius > ARENA_RADIUS - 10) { predicted.x *= (ARENA_RADIUS - 10) / radius; predicted.y *= (ARENA_RADIUS - 10) / radius; }
    return { distance, speed, awayMomentum, lateralMomentum, retreatConfidence, turnConfidence, horizon, predicted, predictedHeading: heading };
  }

  selectTactic(isOpening) {
    this.ensureRuntime();
    const s = this.lastSituation || this.assessSituation();
    const d = dist(this.ai, this.player); const selfEdge = Math.hypot(this.ai.x, this.ai.y); const opponentEdge = Math.hypot(this.player.x, this.player.y);
    const toPlayer = norm({ x: this.player.x - this.ai.x, y: this.player.y - this.ai.y });
    const enemyMomentum = dot({ x: this.player.vx, y: this.player.vy }, toPlayer); const opponentPattern = this.inferOpponentPattern();
    const prediction = this.opponentPrediction(); const selfMargin = this.footprintMargin(this.ai);
    const openingPredictsRetreat = this.opening.likelyOpponentResponses?.includes('retreat') ||
      (this.opening.cornerAdvantage && d > 135 && this.opening.opponentBearing > 0.55);
    const emergency = selfEdge > 184 || this.opening.edgeClearance < 28;
    const sidePushed = s.sidePressure > 0.22 || s.rearPressure > 0.3;
    const losingShove = s.frontalLoss > 10;
    const style = this.opponentStyle();
    // How likely the opponent out-pushes the AI blade-to-blade: in-match evidence
    // first, then what was learned about this opponent in earlier matches.
    const learnedFront = this.aiState.opponentModel?.frontal || { contests: 0, losses: 0 };
    const learnedDisadvantage = (learnedFront.losses + 0.5) / (learnedFront.contests + 2);
    const headOnDisadvantage = clamp(0.6 * Math.min(1, (this.events.frontalLossEpisodes || 0) / 1.5) + 0.4 * (learnedFront.contests >= 3 ? learnedDisadvantage : 0.25), 0, 1);
    this.headOnDisadvantage = headOnDisadvantage;
    const avoidFront = Math.max(0, headOnDisadvantage - 0.3);
    // A straight charge with the blade pointed at the AI: curving in only offers a
    // blade corner; waiting to deflect it (counter) or meeting it squarely is better.
    const straightCharge = !s.touching && s.closingSpeed > 60 && prediction.lateralMomentum < 32 && d < 230 && Math.abs(s.opponentBearing) < 0.5;
    const chargeProbability = this.opening.opponentOpeningProbs?.charge ?? 0;
    const scores = TACTICS.map((def) => {
      const stat = this.aiState.tactics[def.id] || { priority: def.basePriority, params: def.defaultParams, matchups: {} };
      // The learned priority shifts the choice but cannot override the situation:
      // its effect is bounded around the initial value (stored data is untouched).
      const initial = stat.initialPriority ?? def.basePriority;
      // Reflex tactics (triggered by a situation, blamed for the losses they could not
      // prevent) move least; approach tactics carry most of the learned preference.
      const reflex = ['pivot', 'sidestep', 'escape'].includes(def.id);
      let score = clamp(stat.priority, initial - (reflex ? 0.15 : 0.45), initial + (reflex ? 0.15 : 0.6));
      if (def.opening.placements.includes(this.opening.placement)) score += 0.68; else score -= 0.12;
      if (d >= def.opening.distances[0] && d <= def.opening.distances[1]) score += 0.42; else score -= 0.15;
      if (def.id === 'escape') score += selfMargin < 16 ? 8.4 : selfMargin < 42 ? 4.8 : selfMargin < 70 ? 1.4 : -2.4;
      if (def.id === 'direct') {
        score += this.opening.cornerAdvantage ? 2.1 : -0.28; if (opponentPattern === 'retreat' || openingPredictsRetreat) score -= 1.1;
        // Never try to win a shove with the side exposed, nor keep shoving while being out-pushed.
        if (sidePushed) score -= 2.8;
        if (losingShove) score -= 1.9;
      }
      if (def.id === 'zigzag') {
        score += this.opening.cornerAdvantage && d > 135 ? 1.65 : -0.1;
        if (opponentPattern === 'retreat') score += 0.8;
        if (openingPredictsRetreat && d >= 150 && this.opening.space !== 'tight') score += 2.35;
        if (prediction.retreatConfidence > 0.22 && d >= 120 && d <= 330) score += 2.8 * prediction.retreatConfidence;
        if (prediction.turnConfidence > 0.2) score += 0.7 * prediction.turnConfidence;
        if (sidePushed) score -= 1.5;
      }
      if (def.id === 'flank') {
        score += this.opening.space === 'open' && d > 170 ? 1.2 : -0.6;
        // Already beside the opponent: finish the side attack.
        if (s.opponentExposure > 1.0 && d < 160 && !sidePushed && s.selfMargin > 40) score += 1.5;
        if (sidePushed) score -= 1.2;
      }
      if (def.id === 'diagonal') {
        // Cutting in needs the opponent to be turning or moving across the AI's line;
        // against a straight charge a diagonal approach only offers the blade corner.
        const crossing = Math.abs(this.player.omega) > 0.65 || prediction.lateralMomentum > 32;
        score += crossing ? 1.45 : 0.04;
        if (!crossing && s.closingSpeed > 40 && d < 220) score -= 0.8;
      }
      if (def.id === 'doubleZigzag') {
        score += (this.tacticId === 'zigzag' || this.tacticId === 'diagonal') && this.time - this.tacticStartedAt > 0.28 ? 2.0 : -0.4;
        if (s.closingSpeed > 40 && d < 220 && prediction.lateralMomentum < 32) score -= 0.8;
      }
      if (def.id === 'counter') {
        score += this.opening.placement === 'edge' ? 2.0 : enemyMomentum < -28 ? 2.0 : enemyMomentum < -8 ? 0.55 : -0.35;
        if (isOpening && chargeProbability > 0.45 && this.opening.learnedOpenings >= 3) score += 1.2 * chargeProbability;
        if (sidePushed || s.touching) score -= 1.6;
        // Patient, facing opponent while the AI owns the centre: hold and counter.
        const patient = s.opponentSpeed < 30 && Math.abs(s.opponentBearing) < 0.55 && d > 95;
        if (patient && s.selfCenter + 15 < s.opponentCenter) score += 1.6;
        if (patient && this.time > 40 && s.selfCenter < s.opponentCenter) score += 1.0;
      }
      if (def.id === 'reposition') { score += d < 82 && !s.touching ? 2.1 : -0.1; if (losingShove && selfMargin > 70) score += 0.6; }
      if (def.id === 'pivot') score += sidePushed ? 3.4 + 2.2 * clamp(Math.max(s.sidePressure, s.rearPressure), 0, 1) : -3;
      if (def.id === 'sidestep') {
        if (losingShove) score += 2.8 + clamp(s.frontalLoss / 40, 0, 1.2);
        // An even shove that goes nowhere is not worth holding: take the side instead.
        else if (s.frontalContest && s.frontalStall > 1.2 && selfMargin > 90) score += 2.2;
        else if (s.frontalContest && s.closingSpeed > 30 && selfMargin < 80) score += 0.9;
        else score -= 3;
      }
      if (straightCharge) score += ({ counter: 1.4, direct: -0.3, zigzag: -1.0, diagonal: -1.0, doubleZigzag: -1.2, flank: -0.6 }[def.id] || 0);
      if (avoidFront > 0) {
        const shift = { direct: -2.6, diagonal: -1.2, zigzag: -0.6, doubleZigzag: -0.6, flank: 1.8, counter: 0.6, sidestep: 0.4 }[def.id] || 0;
        score += shift * avoidFront / 0.7;
      }
      if (opponentEdge > 170 && def.id !== 'escape') score += 0.3;
      // Learned matchup against the opponent's current style, shrunk toward zero with few samples.
      const matchup = stat.matchups?.[style];
      if (matchup && matchup.uses > 0) score += 0.6 * ((matchup.wins || 0) - (matchup.losses || 0)) / (matchup.uses + 4);
      score -= clamp(this.tacticMemory[def.id] || 0, -0.8, 2.2);
      if (!isOpening && def.id === this.tacticId) {
        const currentExecutionTime = clamp(this.aiState.tactics[this.tacticId]?.params?.executionTime ?? 0.8, 0.45, 1.6);
        const elapsed = Math.max(0, this.time - this.tacticStartedAt);
        score += 0.42 + 0.55 * clamp(1 - elapsed / currentExecutionTime, 0, 1);
        if (this.time < this.tacticLockUntil) score += 0.85;
      }
      return { def, score };
    }).sort((a, b) => b.score - a.score);
    const current = scores.find((candidate) => candidate.def.id === this.tacticId);
    const critical = emergency || sidePushed || losingShove || selfMargin < 42;
    // Exploration only when nothing is at stake.
    let chosen = !critical && this.rand() < 0.1 ? scores[Math.floor(this.rand() * Math.min(3, scores.length))] : scores[0];
    const urgent = emergency || (chosen.def.id === 'pivot' && sidePushed) || (chosen.def.id === 'sidestep' && losingShove) || (chosen.def.id === 'escape' && selfMargin < 42);
    if (current && !urgent && chosen.def.id !== current.def.id) {
      const elapsed = Math.max(0, this.time - this.tacticStartedAt);
      const minHold = clamp(this.aiState.tactics[this.tacticId]?.params?.executionTime ?? 0.8, 0.45, 1.6) * 0.48;
      const meaningfulLead = 0.24;
      if (this.time < this.tacticLockUntil || elapsed < minHold || chosen.score < current.score + meaningfulLead) chosen = current;
    }
    this.lastScores = scores.slice(0, 4).map((entry) => ({ id: entry.def.id, score: Number(entry.score.toFixed(2)) }));
    if (chosen.def.id !== this.tacticId) {
      this.tacticId = chosen.def.id; this.tacticStartedAt = this.time;
      this.tacticLockUntil = this.time + (chosen.def.id === 'escape' ? 0.72 : chosen.def.id === 'pivot' || chosen.def.id === 'sidestep' ? 0.45 : 0.34);
      if (chosen.def.id === 'flank' || chosen.def.id === 'zigzag' || chosen.def.id === 'doubleZigzag') this.flankSide = this.rand() > 0.5 ? 1 : -1;
      this.tacticLatch = {};
      this.usedTactics.add(chosen.def.id); this.tacticHistory.push({ id: chosen.def.id, at: this.time, opening: this.opening.placement, opponentPattern, situation: this.situationLabel() });
      // Counted in memory; persisted by the app when the match ends or is abandoned.
      recordTacticSelection(this.aiState, chosen.def.id);
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
      const executed = usage.selectedSeconds >= minExecutionSeconds && score > 0;
      const opponentPushed = (usage.startOpponentMargin ?? 0) - (usage.endOpponentMargin ?? usage.startOpponentMargin ?? 0);
      const selfLost = (usage.startSelfMargin ?? 0) - (usage.endSelfMargin ?? usage.startSelfMargin ?? 0);
      // Intermediate objective of each tactic — tracked separately from the match result.
      let objective = null;
      if (tacticId === 'escape') objective = null; // evaluated by recordEscapeOutcome
      else if (tacticId === 'pivot') objective = usage.startedUnderPressure ? Boolean(usage.recovered) : null;
      else if (tacticId === 'sidestep') objective = usage.startedLosing ? Boolean(usage.recovered || (usage.sideHitSeconds || 0) > 0.15) : null;
      else if (tacticId === 'reposition') objective = (usage.endDistance - usage.startDistance) > 25 && selfLost < 5;
      else objective = (usage.sideHitSeconds || 0) > 0.15 || (opponentPushed > 25 && selfLost < 12);
      return { tacticId, selectedSeconds: usage.selectedSeconds, contactSeconds: usage.contactSeconds, score: score + progressScore, baseScore: score, stateChange, progressScore,
        startSelfMargin: usage.startSelfMargin, endSelfMargin: usage.endSelfMargin, minSelfMargin: usage.minSelfMargin,
        sideHitSeconds: usage.sideHitSeconds || 0, sidePressureSeconds: usage.sidePressureSeconds || 0, frontalLossSeconds: usage.frontalLossSeconds || 0,
        opponentPushed, selfLost, objective: executed ? objective : null,
        executed };
    }).sort((a, b) => b.score - a.score);
  }

  // Positive heading error (target clockwise on screen) needs the LEFT wheel faster.
  steerTo(target, drive, turnScale = 1) {
    const vector = { x: target.x - this.ai.x, y: target.y - this.ai.y }; const desired = Math.atan2(vector.y, vector.x); const error = angleDelta(desired - this.ai.angle);
    let forward = drive; if (Math.abs(error) > 1.75) forward *= 0.42;
    const turn = clamp(error * 1.9 * turnScale, -1, 1);
    return { left: clamp(forward + turn * 0.82, -1, 1), right: clamp(forward - turn * 0.82, -1, 1) };
  }

  // Heading-hold helper: rotate toward an absolute heading while driving along the body axis.
  steerHeading(heading, drive, turnGain = 1.6) {
    const error = angleDelta(heading - this.ai.angle); const turn = clamp(error * turnGain, -1, 1);
    return { left: clamp(drive + turn * 0.78, -1, 1), right: clamp(drive - turn * 0.78, -1, 1), error };
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
    // Blades locked at the edge: turning inward would expose the side to the pusher.
    // Brace blade-on at full drive and angle slightly toward the centre-side tangent
    // so the opponent's push is deflected along the rim instead of straight out.
    const c = this.contact || NO_CONTACT;
    if (!emergency && c.touching && c.wedgeAI > 0.45 && c.wedgePlayer > 0.45) {
      const brace = this.braceControl();
      this.safetyState = { mode: 'brace', margin, outwardSpeed, relativeOutward };
      return brace;
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

  // Full-power shove with only gentle heading correction: in a pushing contest every
  // bit of wheel differential is force that does not go into the opponent.
  shoveControl(target, maxTurn = 0.35) {
    const error = angleDelta(Math.atan2(target.y - this.ai.y, target.x - this.ai.x) - this.ai.angle);
    const turn = clamp(error * 0.9, -maxTurn, maxTurn);
    return turn >= 0 ? { left: 1, right: 1 - turn * 2 } : { left: 1 + turn * 2, right: 1 };
  }

  braceControl() {
    const ai = this.ai; const player = this.player;
    const toPlayer = norm({ x: player.x - ai.x, y: player.y - ai.y });
    const inward = norm({ x: -ai.x, y: -ai.y });
    const tangent = { x: -toPlayer.y, y: toPlayer.x };
    const sign = dot(tangent, inward) >= 0 ? 1 : -1;
    const target = { x: player.x + tangent.x * sign * 14, y: player.y + tangent.y * sign * 14 };
    return this.shoveControl(target, 0.3);
  }

  controlForTactic() {
    this.ensureRuntime();
    const tactic = this.aiState.tactics[this.tacticId] || this.aiState.tactics.direct; const player = this.player; const ai = this.ai; const d = dist(ai, player);
    const toPlayer = norm({ x: player.x - ai.x, y: player.y - ai.y }); const side = { x: -toPlayer.y * this.flankSide, y: toPlayer.x * this.flankSide };
    const phase = this.time - this.tacticStartedAt;
    const executionTime = clamp(tactic.params.executionTime ?? tacticById(this.tacticId).defaultParams.executionTime, 0.45, 1.6);
    const wiggle = Math.sin(this.time * (5.2 + tactic.params.turnBias * 2)) * (30 + tactic.params.turnBias * 42);
    let target = { x: player.x, y: player.y }; let drive = tactic.params.aggression; let turnScale = 1;
    let direct = null; // a tactic may command the wheels directly instead of steering to a point
    const enemyForward = forwardOf(player); const enemySide = sideOf(player);
    const s = this.lastSituation || this.assessSituation();
    const latch = this.tacticLatch || (this.tacticLatch = {});
    if (this.tacticId === 'escape' && s.frontalContest) {
      direct = this.braceControl();
    } else if (this.tacticId === 'escape') {
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
      // Circle to the opponent's flank (relative to ITS heading), behind the blade,
      // then turn in and drive through its side toward the predicted position.
      const predicted = s.predicted || { x: player.x, y: player.y };
      const flankSign = latch.flankSign ?? (latch.flankSign = Math.sign(dot({ x: ai.x - player.x, y: ai.y - player.y }, enemySide)) || this.flankSide);
      const standoff = 58 + tactic.params.preferredDistance * 0.08;
      const besides = s.opponentExposure > 1.05 && d < 125;
      if (besides) { target = { x: predicted.x - enemySide.x * flankSign * 8, y: predicted.y - enemySide.y * flankSign * 8 }; drive = 0.95; turnScale = 1.2; }
      else { target = { x: predicted.x + enemySide.x * flankSign * standoff - enemyForward.x * 18, y: predicted.y + enemySide.y * flankSign * standoff - enemyForward.y * 18 }; drive = 0.73; turnScale = 1.18; }
    } else if (this.tacticId === 'diagonal') {
      target = { x: player.x + side.x * 64 + toPlayer.x * 22, y: player.y + side.y * 64 + toPlayer.y * 22 }; drive = 0.82; turnScale = 1.12;
    } else if (this.tacticId === 'doubleZigzag') {
      const secondPhase = phase > executionTime * 0.44; const secondSide = secondPhase ? -this.flankSide : this.flankSide; const second = { x: -toPlayer.y * secondSide, y: toPlayer.x * secondSide };
      target = { x: player.x + second.x * (secondPhase ? 42 : 78), y: player.y + second.y * (secondPhase ? 42 : 78) }; drive = secondPhase ? 0.92 : 0.7; turnScale = 1.34;
    } else if (this.tacticId === 'counter') {
      // toPlayer points from the AI toward the player, so negative momentum means approach.
      const incoming = dot({ x: player.vx, y: player.vy }, toPlayer) < -22 || this.opening.placement === 'edge';
      if (phase < executionTime * 0.76 && !incoming) {
        // Wait on the centre with the blade toward the opponent: the judge favours the
        // robot nearer the centre, so a patient opponent has to come and be countered.
        const centre = Math.hypot(ai.x, ai.y);
        if (centre > 28) { direct = this.steerHeading(Math.atan2(-ai.y, -ai.x), 0.45, 1.6); if (Math.abs(direct.error) > 1.4) direct = this.steerHeading(Math.atan2(toPlayer.y, toPlayer.x) + Math.PI, -0.45, 1.6); }
        else direct = this.steerHeading(Math.atan2(toPlayer.y, toPlayer.x), 0, 1.4);
      }
      else if (phase < executionTime * 0.72) { target = { x: ai.x + side.x * 100 - toPlayer.x * 40, y: ai.y + side.y * 100 - toPlayer.y * 40 }; drive = -0.42; turnScale = 1.2; }
      else {
        // Strike its side if it has turned away; if its blade still faces the AI, hit square.
        const offset = Math.abs(s.opponentBearing) < 0.5 ? 0 : 24;
        target = { x: player.x + side.x * offset, y: player.y + side.y * offset }; drive = 0.94; turnScale = 1.2;
      }
    } else if (this.tacticId === 'pivot') {
      // Side/rear push: do not shove back. Drive along the body axis to slide out of
      // the opponent's blade line (toward the centre when near the edge) while turning
      // the blade to face the opponent; once facing, re-engage blade-on.
      const radial = norm({ x: ai.x, y: ai.y }); const inwardForward = -dot(forwardOf(ai), radial);
      const edgeWeight = clamp((90 - s.selfMargin) / 60, 0, 1);
      const contactX = s.contactLocal?.x ?? 0;
      if (latch.axial === undefined) {
        const forwardScore = (-contactX / 28) * (1 - edgeWeight * 0.6) + inwardForward * (0.5 + edgeWeight * 1.8);
        latch.axial = forwardScore >= 0 ? 1 : -1;
      }
      const error = s.bearing; const turnGain = 1.5 * clamp(1 + (tactic.params.turnBias - 0.7) * 0.6, 0.8, 1.25);
      if (s.frontalContest) {
        // Blade is back on the opponent's blade: the side push is solved, shove blade-on.
        direct = this.shoveControl({ x: player.x, y: player.y });
      } else if (Math.abs(error) > 0.55 && (s.touching || s.sidePressure > 0.1)) {
        // Contact near the middle of the side: spinning in place brings the blade round
        // fastest. Contact near an end: slide out along the body axis away from it.
        const endContact = clamp(Math.abs(contactX) / 24, 0, 1);
        const axial = latch.axial * (0.2 + 0.5 * endContact) * (0.75 + 0.3 * tactic.params.aggression);
        const turn = clamp(error * turnGain * 1.3, -1, 1);
        direct = { left: clamp(axial + turn * 0.9, -1, 1), right: clamp(axial - turn * 0.9, -1, 1) };
      } else if (Math.abs(error) > 0.55) { target = { x: player.x, y: player.y }; drive = 0.2; turnScale = 1.45; }
      else { target = s.predicted || { x: player.x, y: player.y }; drive = 0.9; turnScale = 1.1; }
    } else if (this.tacticId === 'sidestep') {
      // Lost head-on shove: yaw ~65° off the opponent's line toward the centre side and
      // slide along its blade so its push glances off, then hit its flank behind the blade.
      const inward = norm({ x: -ai.x, y: -ai.y }); const baseHeading = Math.atan2(toPlayer.y, toPlayer.x);
      if (latch.sideSign === undefined) {
        const plus = { x: Math.cos(baseHeading + 1.15), y: Math.sin(baseHeading + 1.15) }; const minus = { x: Math.cos(baseHeading - 1.15), y: Math.sin(baseHeading - 1.15) };
        const inwardSign = dot(plus, inward) >= dot(minus, inward) ? 1 : -1;
        // Pushed on a blade corner: yaw the way the shove already turns the chassis so
        // the opponent's blade slides off that corner — unless that faces the rim.
        const cornerY = s.contactLocal?.y ?? 0;
        const torqueSign = Math.abs(cornerY) > 6 ? Math.sign(cornerY) : 0;
        latch.sideSign = torqueSign && (torqueSign === inwardSign || s.selfMargin > 70) ? torqueSign : inwardSign;
      }
      const releasePhase = executionTime * (0.5 - (tactic.params.turnBias - 0.62) * 0.25);
      if (phase < Math.min(releasePhase, 0.4)) {
        // Spin the blade to ~65° off the shove line almost in place: beyond the contact
        // friction angle the opponent's blade slides off ours and its own drive carries
        // it past, leaving its side next to the AI.
        direct = this.steerHeading(baseHeading + latch.sideSign * 1.15, -0.05 + tactic.params.aggression * 0.08, 2.6 * clamp(1 + (tactic.params.turnBias - 0.62) * 0.5, 0.8, 1.2));
      } else {
        const flankSign = Math.sign(dot({ x: ai.x - player.x, y: ai.y - player.y }, enemySide)) || latch.sideSign;
        target = { x: player.x + enemySide.x * flankSign * 30 - enemyForward.x * 12, y: player.y + enemySide.y * flankSign * 30 - enemyForward.y * 12 }; drive = 0.92; turnScale = 1.25;
      }
    } else {
      target = { x: player.x + toPlayer.x * 8, y: player.y + toPlayer.y * 8 }; drive = 0.84 + tactic.params.aggression * 0.16; turnScale = 1.08;
    }
    // Never show the side to an opponent whose blade is pointed at the AI at close range:
    // square up first, then continue the tactic.
    const charging = s.closingSpeed > 40 && d < 150;
    const threatened = !s.touching && Math.abs(s.opponentBearing) < 0.6 && (
      (s.closingSpeed > -10 && ((d < 115 && Math.abs(s.bearing) > 0.75) || (charging && Math.abs(s.bearing) > 0.35))) ||
      // Final approach into a facing blade (even one that is backing off and may lunge):
      // meet it squarely, never with a blade corner.
      (d < 100 && Math.abs(s.opponentBearing) < 0.5 && Math.abs(s.bearing) > 0.2));
    const approachTactic = ['direct', 'zigzag', 'flank', 'diagonal', 'doubleZigzag'].includes(this.tacticId);
    if (approachTactic && !direct && threatened) {
      this.squaringUp = true;
      return this.safetyCorrectControl(this.steerTo({ x: player.x, y: player.y }, 0.5, 1.5));
    }
    this.squaringUp = false;
    // Finishing phase shared by the attacking tactics: once the blade is on the
    // opponent's side/back (or it is being driven backward head-on), stop circling and
    // drive through it toward the nearest edge — the shortest way to push it out.
    const attacking = ['direct', 'zigzag', 'flank', 'diagonal', 'doubleZigzag', 'counter', 'sidestep'].includes(this.tacticId);
    const winningFront = s.frontalContest && dot({ x: player.vx, y: player.vy }, toPlayer) > 12;
    // Blade-to-blade: an attacking tactic shoves at full power, squared up.
    if (attacking && !direct && s.frontalContest && !winningFront && this.tacticId !== 'sidestep') {
      return this.safetyCorrectControl(this.shoveControl({ x: player.x, y: player.y }));
    }
    if (attacking && !direct && s.touching && (s.aiOnOpponentFlank || winningFront) && s.selfMargin > 30) {
      const outward = norm({ x: player.x, y: player.y });
      const push = norm({ x: toPlayer.x * 0.55 + outward.x * 0.45, y: toPlayer.y * 0.55 + outward.y * 0.45 });
      target = { x: player.x + push.x * 80, y: player.y + push.y * 80 };
      this.finishing = true;
      // On the flank the opponent can move away sideways, so steering stays livelier.
      return this.safetyCorrectControl(s.aiOnOpponentFlank ? this.steerTo(target, 1, 1.1) : this.shoveControl({ x: player.x, y: player.y }));
    }
    this.finishing = false;
    const tacticDefaults = tacticById(this.tacticId).defaultParams;
    const defaultAggression = tacticDefaults.aggression;
    drive = clamp(drive * tactic.params.aggression / defaultAggression, -1, 1);
    turnScale *= clamp(1 + (tactic.params.turnBias - tacticDefaults.turnBias) * 0.5, 0.75, 1.25);
    // Close-range commitment for attacking tactics only; evasive tactics keep their own drive.
    if (d < 65 && !['escape', 'counter', 'pivot', 'sidestep', 'reposition'].includes(this.tacticId)) drive = Math.max(drive, 0.7);
    return this.safetyCorrectControl(direct ? { left: direct.left, right: direct.right } : this.steerTo(target, drive, turnScale));
  }

  classifyFailure(winner) {
    const aiEdge = Math.hypot(this.ai.x, this.ai.y); const opponentPattern = this.inferOpponentPattern();
    if (winner === 'ai') return opponentPattern === 'retreat' ? 'clean-read' : 'pressure-success';
    if (aiEdge > 165) return (this.events?.sidePressureSeconds || 0) > 0.4 ? 'side-pushed' : 'edge-risk';
    if (opponentPattern === 'retreat') return 'opponent-retreat';
    if (Math.abs(this.player.omega) > 1.25 && ['zigzag', 'doubleZigzag', 'diagonal'].includes(this.tacticId)) return 'late-turn';
    if ((this.events?.frontalLossSeconds || 0) > 0.6) return 'out-pushed';
    return 'read-miss';
  }

  keepTrails() { [this.player, this.ai].forEach((unit) => { unit.trail.push({ x: unit.x, y: unit.y }); if (unit.trail.length > 10) unit.trail.shift(); }); }

  finish(winner, reason, ringOut = {}) {
    if (this.ended) return; this.ended = true; this.running = false; this.releaseInputs?.();
    if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame); this.draw();
    const finalTactic = tacticById(this.tacticId || 'direct');
    const tacticUsage = this.evaluateTacticUsage();
    const evaluatedTactic = tacticUsage.find((usage) => usage.executed);
    const aiOut = Boolean(ringOut.aiOut); const playerOut = Boolean(ringOut.playerOut);
    const kind = aiOut && playerOut ? 'double-out' : playerOut ? 'ai-push-out' : aiOut ? 'ai-ring-out' : winner === 'draw' ? 'judge-draw' : winner === 'ai' ? 'ai-judge-win' : 'ai-judge-loss';
    this.onFinish?.({ winner, reason, kind, aiOut, playerOut, aiOutMargin: this.footprintMargin(this.ai), playerOutMargin: this.footprintMargin(this.player), lastSafetyMode: this.safetyState?.mode || 'unknown',
      tacticBeforeRingOut: finalTactic.id, tacticId: finalTactic.id, tacticName: finalTactic.name, learningTacticId: evaluatedTactic?.tacticId || null,
      tacticUsage, time: this.time, distance: dist(this.player, this.ai), selfEdge: Math.hypot(this.ai.x, this.ai.y), opponentEdge: Math.hypot(this.player.x, this.player.y),
      usedTactics: [...this.usedTactics], tacticHistory: this.tacticHistory, opening: this.opening, opponentTactic: this.inferOpponentPattern(),
      opponentStyle: this.opponentStyle?.() || this.inferOpponentPattern(), openingMove: this.openingMove || null,
      events: { ...(this.events || {}) }, failureCause: this.classifyFailure(winner) });
  }

  draw() {
    const ctx = this.ctx; if (!ctx) return;
    const w = this.width; const h = this.height; const centerX = w / 2; const centerY = h / 2;
    const scale = Math.min((w - 20) / (ARENA_RADIUS * 2 + 44), (h - 20) / (ARENA_RADIUS * 2 + 44)); ctx.clearRect(0, 0, w, h); ctx.save(); ctx.translate(centerX, centerY); ctx.scale(scale, scale);
    this.drawArena(ctx); this.drawTrail(ctx, this.player); this.drawTrail(ctx, this.ai);
    this.drawEdgeWarning(ctx, this.player); this.drawEdgeWarning(ctx, this.ai);
    this.drawRobot(ctx, this.player, this.sprites?.player); this.drawRobot(ctx, this.ai, this.sprites?.ai); this.drawContact(ctx); ctx.restore();
    if (this.countdown > 0 && !this.ended) { ctx.save(); ctx.fillStyle = 'rgba(7, 12, 19, .38)'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 62px system-ui, sans-serif'; ctx.fillStyle = '#fff2bf'; ctx.shadowColor = 'rgba(255,176,74,.7)'; ctx.shadowBlur = 22; ctx.fillText(this.countdown > 0.5 ? Math.ceil(this.countdown).toString() : 'GO', centerX, centerY); ctx.restore(); }
    if (this.paused && !this.ended) { ctx.save(); ctx.fillStyle = 'rgba(7, 12, 19, .62)'; ctx.fillRect(0, 0, w, h); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 26px system-ui, sans-serif'; ctx.fillStyle = '#f4f6ef'; ctx.fillText('一時停止中', centerX, centerY - 10); ctx.font = '500 13px system-ui, sans-serif'; ctx.fillStyle = '#8b9ba7'; ctx.fillText('画面をタップして再開', centerX, centerY + 18); ctx.restore(); }
  }

  drawArena(ctx) {
    const gradient = ctx.createRadialGradient(0, -28, 30, 0, 0, ARENA_RADIUS + 25); gradient.addColorStop(0, '#263847'); gradient.addColorStop(0.7, '#172530'); gradient.addColorStop(1, '#101821');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS + 16, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(82,214,197,.32)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#1e2d38'; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS, 0, TAU); ctx.fill(); ctx.strokeStyle = '#d6b56a'; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.setLineDash([4, 7]); ctx.strokeStyle = 'rgba(255,244,197,.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS - 22, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // Shikiri (start) lines.
    ctx.strokeStyle = 'rgba(160,110,60,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-20, -28); ctx.lineTo(-20, 28); ctx.moveTo(20, -28); ctx.lineTo(20, 28); ctx.stroke();
    ctx.fillStyle = 'rgba(255,176,74,.78)'; ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, TAU); ctx.fill();
  }

  drawTrail(ctx, unit) {
    unit.trail.forEach((point, index) => { const alpha = (index / unit.trail.length) * 0.12; ctx.globalAlpha = alpha; ctx.fillStyle = unit.color; ctx.beginPath(); ctx.arc(point.x, point.y, 4 + index * 0.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; });
  }

  drawEdgeWarning(ctx, unit) {
    const margin = this.footprintMargin(unit); if (margin > 28) return;
    const angle = Math.atan2(unit.y, unit.x); const strength = clamp((28 - margin) / 28, 0, 1);
    ctx.save(); ctx.strokeStyle = `rgba(255,96,96,${0.25 + strength * 0.55})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, ARENA_RADIUS, angle - 0.32, angle + 0.32); ctx.stroke(); ctx.restore();
  }

  drawContact(ctx) {
    const c = this.contact; if (!c?.touching || !c.point) return;
    const advantage = c.wedgeAI - c.wedgePlayer; const color = advantage > 0.3 ? '82,214,197' : advantage < -0.3 ? '255,176,74' : '244,246,239';
    const radius = 4 + clamp(c.force / 120, 0, 6);
    ctx.save(); ctx.fillStyle = `rgba(${color},.85)`; ctx.beginPath(); ctx.arc(c.point.x, c.point.y, radius, 0, TAU); ctx.fill(); ctx.restore();
  }

  drawRobot(ctx, unit, sprite) {
    ctx.save(); ctx.translate(unit.x, unit.y); ctx.rotate(unit.angle);
    // Team-coloured outline of the true collision footprint and a heading chevron.
    const outline = new Path2D(); FOOTPRINT.forEach((p, i) => (i ? outline.lineTo(p.x, p.y) : outline.moveTo(p.x, p.y))); outline.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.translate(2, 3); ctx.fill(outline); ctx.translate(-2, -3);
    if (sprite?.complete && sprite.naturalWidth > 0) {
      // The sprite's blade is at image-bottom; rotate so it points along +X (forward).
      ctx.save(); ctx.rotate(-Math.PI / 2); ctx.drawImage(sprite, -25, -28, 50, 60); ctx.restore();
    } else this.drawRobotFallback(ctx, unit);
    ctx.strokeStyle = unit.color; ctx.lineWidth = 2.2; ctx.stroke(outline);
    ctx.fillStyle = unit.color; ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(34, -5); ctx.lineTo(34, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(240,248,255,.9)'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(unit.name, unit.x, unit.y - 40);
  }

  drawRobotFallback(ctx, unit) {
    const body = new Path2D();
    body.moveTo(31, -10); body.lineTo(26, -21); body.lineTo(18, -23); body.lineTo(-24, -23); body.lineTo(-28, -18);
    body.lineTo(-28, 18); body.lineTo(-24, 23); body.lineTo(18, 23); body.lineTo(26, 21); body.lineTo(31, 10); body.closePath();
    const hull = ctx.createLinearGradient(-18, -23, 15, 23); hull.addColorStop(0, '#d4d9d6'); hull.addColorStop(0.24, unit.color); hull.addColorStop(1, '#303a42');
    ctx.fillStyle = hull; ctx.fill(body);
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

export { ARENA_RADIUS, ROBOT_HALF_SIZE, ROBOT_RADIUS, FOOTPRINT, GRIP_ACCEL, DRIVE_ACCEL, MAX_SPEED, contactManifold, forwardOf, sideOf, toLocal };
