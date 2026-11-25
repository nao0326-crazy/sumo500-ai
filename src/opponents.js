// Scripted opponents for automated tests and headless evaluation (not used in the app UI).
// They drive the player robot through the same physics and wheel commands as a human.
import { BattleSimulation } from './game.js';

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Positive heading error = target is clockwise on screen = robot must turn right = left wheel faster.
const wheels = (drive, error, gain) => ({ left: clamp(drive + error * gain, -1, 1), right: clamp(drive - error * gain, -1, 1) });

export const OPPONENT_TYPES = {
  direct: { label: '直進型', drivePower: 1 },
  retreat: { label: '後退型', drivePower: 1 },
  turn: { label: '旋回型', drivePower: 1 },
  random: { label: '不規則型', drivePower: 1 },
  counter: { label: 'カウンター型', drivePower: 1 },
  strong: { label: '高出力直進型', drivePower: 1.25 },
  flanker: { label: '側面狙い型', drivePower: 1 }
};

export function createOpponent(type, random) {
  let hold = { left: 0, right: 0 }; let holdUntil = 0;
  return (sim, t) => {
    const p = sim.player; const a = sim.ai;
    const toAI = Math.atan2(a.y - p.y, a.x - p.x); const error = wrap(toAI - p.angle);
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    switch (type) {
      case 'direct': case 'strong': return wheels(0.85, error, 0.6);
      case 'retreat': {
        // Backs away while facing the AI, but steers back toward the centre near the edge.
        const r = Math.hypot(p.x, p.y);
        if (r > 150) return wheels(0.6, wrap(Math.atan2(-p.y, -p.x) - p.angle), 0.7);
        return wheels(-0.62, error, 0.45);
      }
      case 'turn': { const sign = Math.sin(t * 0.8) > 0 ? 1 : -1; return { left: clamp(0.55 + sign * 0.72, -1, 1), right: clamp(0.55 - sign * 0.72, -1, 1) }; }
      case 'counter': {
        // Waits, backs off when the AI closes in, then strikes at short range; never backs over the edge.
        const r = Math.hypot(p.x, p.y);
        const backing = d < 125 && d >= 80;
        if (backing && r > 140) return wheels(0.9, error, 0.8);
        const drive = d < 125 ? (d < 80 ? 0.9 : -0.55) : 0.12; return wheels(drive, error, 0.8);
      }
      case 'flanker': {
        // Aim at the side of the AI (behind its blade); attack once beside it.
        const f = { x: Math.cos(a.angle), y: Math.sin(a.angle) }; const s = { x: -f.y, y: f.x };
        const sign = Math.sign((p.x - a.x) * s.x + (p.y - a.y) * s.y) || 1;
        const beside = Math.abs(wrap(Math.atan2(p.y - a.y, p.x - a.x) - a.angle)) > 1.1;
        const target = beside && d < 110 ? { x: a.x, y: a.y } : { x: a.x + s.x * sign * 70 - f.x * 15, y: a.y + s.y * sign * 70 - f.y * 15 };
        return wheels(0.82, wrap(Math.atan2(target.y - p.y, target.x - p.x) - p.angle), 0.75);
      }
      case 'random': default:
        if (t >= holdUntil) { hold = { left: random() * 1.8 - 0.8, right: random() * 1.8 - 0.8 }; holdUntil = t + 0.25 + random() * 0.45; }
        return hold;
    }
  };
}

// Plays one full match headlessly. `learn` is applied by the caller.
export function playMatch(aiState, type, seed, { maxSeconds = 58.5, setup = 'standard' } = {}) {
  const random = seededRandom(seed);
  let outcome = null;
  const sim = BattleSimulation.createHeadless(aiState, { random, setup, onFinish: (o) => { outcome = o; } });
  sim.player.drivePower = OPPONENT_TYPES[type]?.drivePower ?? 1;
  sim.countdown = 0; sim.running = true; sim.selectTactic(true);
  const opponent = createOpponent(type, seededRandom(seed ^ 0x9e3779b9));
  const dt = 1 / 120;
  for (let i = 0; i < maxSeconds / dt && !outcome; i += 1) {
    const control = opponent(sim, sim.time);
    sim.setInput('left', control.left); sim.setInput('right', control.right);
    sim.step(dt);
  }
  return outcome;
}
