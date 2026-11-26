// Learning-data protection: migration, corruption recovery, save-failure detection,
// export/import round trip, backups, checkpoints and separate outcome bookkeeping.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatchLearning, createDefaultAI, DATA_VERSION, exportAI, getLoadReport, getSaveReport, importAI, listBackups, loadAI,
  maybeCheckpoint, parseImport, recordObjective, resetAI, restoreBackup, rollbackToCheckpoint, saveAI, TACTICS
} from './data.js';
import { loadSettings, sanitizeSettings, saveSettings, shapeStick } from './settings.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  };
}

function v3Data() {
  const ai = createDefaultAI(); ai.version = 3; ai.matches = 25; ai.wins = 11; ai.losses = 12; ai.draws = 2;
  ai.tactics.direct.priority = 1.4; ai.tactics.direct.params.aggression = 0.93; ai.tactics.zigzag.wins = 5; ai.tactics.zigzag.evaluatedMatches = 9;
  ai.escapeStats = { attempts: 4, recoveries: 3, failures: 1, lastMarginGain: 12 };
  delete ai.resultBreakdown; delete ai.opponentModel; delete ai.checkpoints; delete ai.recentResults; delete ai.situationStats;
  delete ai.tactics.pivot; delete ai.tactics.sidestep;
  TACTICS.forEach(({ id }) => { if (ai.tactics[id]) delete ai.tactics[id].objective; });
  return ai;
}

test('v3 learning data migrates to the current format without losing anything, and the original is backed up once', () => {
  const original = JSON.stringify(v3Data());
  const store = memoryStorage({ 'sumo500-ai-v2': original });
  const ai = loadAI(store);
  assert.equal(ai.version, DATA_VERSION);
  assert.deepEqual([ai.matches, ai.wins, ai.losses, ai.draws], [25, 11, 12, 2]);
  assert.equal(ai.tactics.direct.priority, 1.4); assert.equal(ai.tactics.direct.params.aggression, 0.93);
  assert.equal(ai.tactics.zigzag.wins, 5); assert.equal(ai.tactics.zigzag.evaluatedMatches, 9);
  assert.deepEqual(ai.escapeStats, { attempts: 4, recoveries: 3, failures: 1, lastMarginGain: 12 });
  assert.ok(ai.tactics.pivot && ai.tactics.sidestep, 'new tactics are added with defaults');
  assert.equal(getLoadReport().status, 'migrated');
  const backups = [...store.map.keys()].filter((key) => key.startsWith('sumo500-ai-backup:migration-v3:'));
  assert.equal(backups.length, 1);
  assert.equal(store.getItem('sumo500-ai-v2'), original, 'loading alone never rewrites the stored data');
  saveAI(ai, store); loadAI(store); loadAI(store);
  assert.equal([...store.map.keys()].filter((key) => key.startsWith('sumo500-ai-backup:migration-')).length, 1, 'no duplicate migration backups');
});

test('corrupted stored data is kept under a backup key instead of being silently overwritten', () => {
  const store = memoryStorage({ 'sumo500-ai-v2': '{"version":3,"matches":12, BROKEN' });
  const ai = loadAI(store);
  assert.equal(ai.matches, 0);
  const report = getLoadReport();
  assert.equal(report.status, 'corrupt');
  assert.equal(store.getItem(report.backupKey), '{"version":3,"matches":12, BROKEN');
});

test('partially invalid values are repaired on load', () => {
  const data = createDefaultAI(); data.matches = 'x'; data.tactics.direct.priority = null; data.tactics.flank.params.turnBias = 'NaN'; data.recentResults = ['ai', 'bogus', 'player'];
  const ai = loadAI(memoryStorage({ 'sumo500-ai-v2': JSON.stringify(data) }));
  assert.equal(ai.matches, 0); assert.equal(ai.tactics.direct.priority, TACTICS[0].basePriority);
  assert.ok(Number.isFinite(ai.tactics.flank.params.turnBias)); assert.deepEqual(ai.recentResults, ['ai', 'player']);
});

test('save failures are detected and reported, not swallowed', () => {
  const full = { getItem: () => null, setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } };
  assert.equal(saveAI(createDefaultAI(), full), false);
  assert.equal(getSaveReport().ok, false); assert.equal(getSaveReport().error, 'QuotaExceededError');
  const lying = { getItem: () => 'something else', setItem: () => {} };
  assert.equal(saveAI(createDefaultAI(), lying), false, 'a write that does not read back is a failure');
  const ok = memoryStorage(); assert.equal(saveAI(createDefaultAI(), ok), true); assert.equal(getSaveReport().ok, true);
});

test('unavailable storage (private mode) starts a fresh AI and reports it', () => {
  const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
  const ai = loadAI(broken);
  assert.equal(ai.matches, 0); assert.equal(getLoadReport().status, 'storage-unavailable');
});

test('export → import round trip restores identical learning data; import backs up the current data first', () => {
  const source = createDefaultAI();
  applyMatchLearning(source, { winner: 'ai', aiOut: false, playerOut: true, tacticUsage: [{ tacticId: 'flank', executed: true, score: 3, selectedSeconds: 2, contactSeconds: 0.4, objective: true }], opening: { placement: 'mid' }, opponentStyle: 'direct', openingMove: 'charge', events: { sideHitSeconds: 0.6 } });
  const file = exportAI(source);
  const parsed = parseImport(file);
  assert.equal(parsed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.ai)), JSON.parse(JSON.stringify(source)));
  const store = memoryStorage(); const current = createDefaultAI(); current.matches = 3; saveAI(current, store);
  const result = importAI(parsed.ai, store);
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(store.getItem(result.backupKey)).matches, 3, 'previous data kept as backup');
  assert.deepEqual(JSON.parse(JSON.stringify(loadAI(store))), JSON.parse(JSON.stringify(source)));
  // Re-export of the imported data imports again.
  assert.equal(parseImport(exportAI(loadAI(store))).ok, true);
});

test('import accepts a raw saved object and rejects garbage or newer formats', () => {
  assert.equal(parseImport(JSON.stringify(v3Data())).ok, true);
  assert.equal(parseImport('not json').ok, false);
  assert.equal(parseImport(JSON.stringify({ hello: 1 })).ok, false);
  const future = createDefaultAI(); future.version = DATA_VERSION + 1;
  assert.equal(parseImport(JSON.stringify(future)).ok, false);
});

test('backups are listed with summaries and can be restored', () => {
  const store = memoryStorage(); const a = createDefaultAI(); a.matches = 7; saveAI(a, store);
  importAI(createDefaultAI(), store);
  const list = listBackups(store);
  assert.equal(list.length, 1); assert.equal(list[0].reason, 'before-import'); assert.equal(list[0].summary.matches, 7);
  const restored = restoreBackup(list[0].key, store);
  assert.equal(restored.ok, true); assert.equal(loadAI(store).matches, 7);
  const reset = resetAI(store);
  assert.equal(reset.matches, 0);
  assert.ok(listBackups(store).some((b) => b.reason === 'before-reset' && b.summary.matches === 7));
});

test('match bookkeeping keeps wins, how the match ended, and intermediate objectives separate', () => {
  const ai = createDefaultAI();
  const usage = (tacticId, objective) => ({ tacticId, executed: true, score: 2, selectedSeconds: 1.5, contactSeconds: 0.3, objective });
  applyMatchLearning(ai, { winner: 'player', aiOut: true, playerOut: false, tacticUsage: [usage('pivot', true)], opening: { placement: 'mid' }, events: {} });
  applyMatchLearning(ai, { winner: 'ai', aiOut: false, playerOut: false, tacticUsage: [usage('flank', false)], opening: { placement: 'mid' }, events: {} });
  assert.deepEqual(ai.resultBreakdown, { pushOutWins: 0, judgeWins: 1, ringOutLosses: 1, judgeLosses: 0, judgeDraws: 0, doubleOuts: 0 });
  assert.equal(ai.tactics.pivot.objective.successes, 1); assert.equal(ai.tactics.pivot.wins, 0, 'an objective success is not a win');
  assert.equal(ai.tactics.pivot.losses, 1);
  assert.equal(ai.tactics.flank.objective.attempts, 1); assert.equal(ai.tactics.flank.objective.successes, 0); assert.equal(ai.tactics.flank.wins, 1);
  const before = ai.tactics.zigzag.priority; recordObjective(ai, usage('zigzag', true));
  assert.ok(ai.tactics.zigzag.priority - before < 0.02, 'objective learning step is small compared with a match result');
});

test('checkpoints every 10 matches; rolling back restores tactic tuning but keeps the match record', () => {
  const ai = createDefaultAI(); const store = memoryStorage();
  for (let i = 0; i < 10; i += 1) applyMatchLearning(ai, { winner: i % 2 ? 'ai' : 'player', tacticUsage: [{ tacticId: 'direct', executed: true, score: 1, selectedSeconds: 1, contactSeconds: 0 }], opening: { placement: 'mid' }, events: {} });
  assert.equal(ai.checkpoints.length, 1); assert.equal(ai.checkpoints[0].matches, 10);
  const saved = ai.checkpoints[0].tactics.direct.priority;
  ai.tactics.direct.priority = 2.1; ai.tactics.direct.params.aggression = 0.4;
  const r = rollbackToCheckpoint(ai, 10, store);
  assert.equal(r.ok, true); assert.equal(ai.tactics.direct.priority, saved); assert.equal(ai.matches, 10);
  assert.equal(maybeCheckpoint(ai), null, 'no duplicate checkpoint for the same match count');
  assert.ok(listBackups(store).some((b) => b.reason === 'before-rollback'));
});

test('settings are sanitised and stick shaping honours dead zone and sensitivity', () => {
  assert.deepEqual(sanitizeSettings({ stickSensitivity: 9, deadzone: -1, vibration: 'yes', startSetup: 'weird' }), { stickSensitivity: 1.4, deadzone: 0, vibration: true, showAIInfo: true, startSetup: 'standard', torqueSpeed: 50, torqueSpeedBySetup: { standard: 50 } });
  const store = memoryStorage(); saveSettings({ deadzone: 0.1 }, store); assert.equal(loadSettings(store).deadzone, 0.1);
  const opts = { stickSensitivity: 1, deadzone: 0.1 };
  assert.equal(shapeStick(0.05, opts), 0); assert.equal(shapeStick(1, opts), 1); assert.equal(shapeStick(-1, opts), -1);
  assert.ok(Math.abs(shapeStick(0.55, opts) - 0.5) < 1e-9);
  assert.equal(shapeStick(0.8, { stickSensitivity: 1.4, deadzone: 0 }), 1);
});
