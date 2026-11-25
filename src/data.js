// The storage key is kept from earlier releases so existing learning data is found.
const STORAGE_KEY = 'sumo500-ai-v2';
const LEGACY_KEY = 'sumo500-ai-v1';
const BACKUP_PREFIX = 'sumo500-ai-backup:';
const MAX_BACKUPS = 8;
export const DATA_VERSION = 4;
export const EXPORT_FORMAT = 'sumo500-ai-export';

export const PLACEMENT_LABELS = {
  edge: '土俵際',
  corner: '角有利',
  close: '近距離',
  mid: '中距離',
  open: '空き広め'
};

export const TACTICS = [
  {
    id: 'direct', name: '直進 / 正面突破', icon: '↗', color: '#ffb04a',
    pattern: '相手の角を捉えたら左右輪をそろえて最短距離で接近する。',
    conditions: '自機のブレードが相手の角に有利で、距離が中〜近距離の時。',
    effect: '反応される前に接触し、直線の押し合いへ持ち込む。',
    pitfalls: '相手が引くと、接触点を失ったまま前へ流れる。',
    basePriority: 1.12, defaultParams: { aggression: 0.86, preferredDistance: 178, turnBias: 0.22, executionTime: 0.78 },
    opening: { placements: ['corner', 'close', 'mid'], distances: [80, 260], beats: ['retreat', 'wait'], difficulty: 1, risk: 0.34 }
  },
  {
    id: 'zigzag', name: '引き読みくの字', icon: '⌁', color: '#52d6c5',
    pattern: '相手が直進を警戒して引く到達点へ、左右輪の速度差で先回りする。',
    conditions: '角有利を取れているが、中距離で相手の後退余地がある時。',
    effect: '相手の左右どちらの引きにも方向転換を足して対応する。',
    pitfalls: '読み外し時は初動で側面を晒し、直進にも旋回にも負けやすい。',
    basePriority: 1.02, defaultParams: { aggression: 0.76, preferredDistance: 226, turnBias: 0.48, executionTime: 1.02 },
    opening: { placements: ['corner', 'mid', 'open'], distances: [150, 310], beats: ['retreat', 'direct'], difficulty: 3, risk: 0.58 }
  },
  {
    id: 'flank', name: '側面回り込み', icon: '◌', color: '#b993ff',
    pattern: '相手の左右へ弧を描き、側面または背面へ回り込む。',
    conditions: '距離と空きスペースが十分あり、相手の正面を避けたい時。',
    effect: '正面の押し合いを避け、横方向から押す。',
    pitfalls: '近距離や土俵際では旋回中に自機の逃げ道がなくなる。',
    basePriority: 0.94, defaultParams: { aggression: 0.68, preferredDistance: 252, turnBias: 0.72, executionTime: 1.12 },
    opening: { placements: ['open', 'mid'], distances: [190, 360], beats: ['direct'], difficulty: 3, risk: 0.62 }
  },
  {
    id: 'diagonal', name: 'くの字刈り / 斜め攻撃', icon: '◇', color: '#ff779f',
    pattern: '相手のくの字の旋回初動へ差し込み、斜めの接触点を作る。',
    conditions: '相手の旋回または横移動が見え、正面衝突を避けたい時。',
    effect: '相手の側面へ先に刃先を置き、軸を崩す。',
    pitfalls: '相手の旋回を読み違えると接触面が浅くなる。',
    basePriority: 0.98, defaultParams: { aggression: 0.73, preferredDistance: 205, turnBias: 0.6, executionTime: 0.86 },
    opening: { placements: ['mid', 'open', 'close'], distances: [110, 270], beats: ['zigzag', 'flank'], difficulty: 4, risk: 0.58 }
  },
  {
    id: 'counter', name: '待ち・カウンター / 回避反撃', icon: '↩', color: '#6ca9ff',
    pattern: '無理に動かず相手の進入線を待ち、横滑りまたは反転で差し返す。',
    conditions: '土俵際、または相手がこちらへ加速している時。',
    effect: '相手の勢いと狭い進入角を利用して反撃する。',
    pitfalls: '待ちすぎると相手の角を正面で受ける。',
    basePriority: 1.0, defaultParams: { aggression: 0.7, preferredDistance: 236, turnBias: 0.56, executionTime: 1.08 },
    opening: { placements: ['edge', 'close'], distances: [70, 240], beats: ['direct', 'zigzag'], difficulty: 3, risk: 0.42 }
  },
  {
    id: 'doubleZigzag', name: '二段くの字', icon: '〽', color: '#d783ff',
    pattern: '一度目の方向転換で攻撃が成立しなければ、反対側へ追加旋回して追撃する。',
    conditions: '一段目で相手の軸を崩せず、まだ横の空きが残っている時。',
    effect: '最初の読み外しを二段目の左右輪切り替えでリカバリーする。',
    pitfalls: '二段目の判断が遅いと、土俵際へ流れてリスクが急増する。',
    basePriority: 0.78, defaultParams: { aggression: 0.72, preferredDistance: 214, turnBias: 0.66, executionTime: 1.28 },
    opening: { placements: ['open', 'mid'], distances: [150, 300], beats: ['zigzag', 'flank'], difficulty: 4, risk: 0.7 }
  },
  {
    id: 'reposition', name: '後退位置調整', icon: '⇢', color: '#f3d36b',
    pattern: '中心側へ後退しながら向きを整え、再び攻撃できる距離を作る。',
    conditions: '距離が詰まりすぎた、または自機の軸が乱れた時。',
    effect: '次の戦術のための安全な助走距離を確保する。',
    pitfalls: '後退中に相手が追従すると、縁際で選択肢が減る。',
    basePriority: 0.7, defaultParams: { aggression: 0.42, preferredDistance: 275, turnBias: 0.36, executionTime: 0.72 },
    opening: { placements: ['close'], distances: [0, 100], beats: ['direct'], difficulty: 2, risk: 0.52 }
  },
  {
    id: 'escape', name: '土俵際からの脱出', icon: '⟲', color: '#ff8666',
    pattern: '中心方向へ最大トルクをかけ、必要なら後退しながら縁から離れる。',
    conditions: '自機が土俵際に近い時。全候補より優先する。',
    effect: '攻撃より生存を優先し、場内へ戻る。',
    pitfalls: '接触中は戻る方向と押し合い方向が一致しないことがある。',
    basePriority: 1.35, defaultParams: { aggression: 0.9, preferredDistance: 300, turnBias: 0.32, executionTime: 0.9 },
    opening: { placements: ['edge'], distances: [0, 220], beats: ['direct', 'flank'], difficulty: 2, risk: 0.18 }
  },
  {
    id: 'pivot', name: '横押し回避・向き直り', icon: '⟳', color: '#9be36b',
    pattern: '横や後ろから押されたら、押し返さずに車体の軸方向へ抜けて力の線を外し、旋回してブレードを相手へ向け直す。',
    conditions: '機体の側面・背面に強い押し込みを受けている時。土俵際では中心側へ抜ける向きを選ぶ。',
    effect: '横向きの不利な押し合いを解消し、正面か相手の側面で組み直す。',
    pitfalls: '抜ける向きを誤ると、相手のブレードに長く捕まる。',
    basePriority: 1.05, defaultParams: { aggression: 0.8, preferredDistance: 120, turnBias: 0.7, executionTime: 0.7 },
    opening: { placements: [], distances: [0, 110], beats: ['direct', 'flank'], difficulty: 2, risk: 0.3 }
  },
  {
    id: 'sidestep', name: 'いなし・接触解除', icon: '⤳', color: '#5fd0ff',
    pattern: '正面の押し合いで押し負けたら、斜めに外して相手の押しを流し、相手の側面へ入り直す。',
    conditions: '正面で接触したまま後退させられている時（相手の押す力が上回る時）。',
    effect: '勝てない力比べを打ち切り、相手の勢いを使って側面を取る。',
    pitfalls: '外すのが遅いと、土俵際で横を向いたまま押される。',
    basePriority: 0.98, defaultParams: { aggression: 0.78, preferredDistance: 150, turnBias: 0.62, executionTime: 0.85 },
    opening: { placements: [], distances: [0, 120], beats: ['direct'], difficulty: 3, risk: 0.45 }
  }
];

function defaultTactic(def) {
  return {
    uses: 0, selections: 0, executions: 0, evaluatedMatches: 0, wins: 0, losses: 0, draws: 0,
    successes: 0, failures: 0, initialPriority: def.basePriority, priority: def.basePriority,
    params: { ...def.defaultParams }, contexts: { success: [], failure: [] },
    placementStats: {}, matchups: {}, failureReasons: {}, lastChange: '初期値',
    objective: { attempts: 0, successes: 0 }
  };
}

function defaultResultBreakdown() {
  return { pushOutWins: 0, judgeWins: 0, ringOutLosses: 0, judgeLosses: 0, judgeDraws: 0, doubleOuts: 0 };
}

export function createDefaultAI() {
  const tactics = {};
  TACTICS.forEach((def) => { tactics[def.id] = defaultTactic(def); });
  return {
    version: DATA_VERSION, matches: 0, wins: 0, losses: 0, draws: 0, tactics,
    escapeStats: { attempts: 0, recoveries: 0, failures: 0, lastMarginGain: 0 },
    resultBreakdown: defaultResultBreakdown(),
    situationStats: { sideHitSeconds: 0, sidePressureSeconds: 0, sideEpisodes: 0, frontalLossSeconds: 0, pivotAttempts: 0, pivotRecoveries: 0 },
    opponentModel: { matches: 0, styles: {}, openings: {}, frontal: { contests: 0, losses: 0 } },
    recentResults: [], checkpoints: [],
    placementStats: {}, recentChanges: [], learningHistory: [], lastUpdated: null, createdAt: new Date().toISOString()
  };
}

// null / '' / booleans would coerce to 0 or 1 — treat them as missing, not as a number.
const finite = (value, fallback) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? (Number.isFinite(Number(value)) ? Number(value) : fallback) : fallback);
const plainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
function sanitizeCounts(map, fields) {
  const result = {};
  for (const [key, entry] of Object.entries(plainObject(map))) {
    const source = plainObject(entry); result[key] = {};
    for (const field of fields) result[key][field] = Math.max(0, finite(source[field], 0));
  }
  return result;
}
function sanitizeNumberMap(map) {
  const result = {};
  for (const [key, value] of Object.entries(plainObject(map))) result[key] = Math.max(0, finite(value, 0));
  return result;
}

function mergeWithDefaults(saved) {
  const base = createDefaultAI();
  if (!saved || typeof saved !== 'object') return base;
  // Unknown or missing versions that still look like AI data are read as the newest
  // understood layout rather than discarded.
  const version = [1, 2, 3, 4].includes(saved.version) ? saved.version : (saved.tactics ? Math.min(DATA_VERSION, Math.max(3, finite(saved.version, 3))) : null);
  if (version === null) return base;
  const merged = {
    ...base, ...saved, version: DATA_VERSION, tactics: { ...base.tactics },
    matches: Math.max(0, finite(saved.matches, 0)), wins: Math.max(0, finite(saved.wins, 0)), losses: Math.max(0, finite(saved.losses, 0)), draws: Math.max(0, finite(saved.draws, 0)),
    placementStats: sanitizeCounts(saved.placementStats, ['uses', 'wins', 'losses', 'draws']),
    escapeStats: { ...base.escapeStats, ...sanitizeNumberMap(saved.escapeStats), lastMarginGain: finite(saved.escapeStats?.lastMarginGain, 0) },
    resultBreakdown: { ...base.resultBreakdown, ...sanitizeNumberMap(saved.resultBreakdown) },
    situationStats: { ...base.situationStats, ...sanitizeNumberMap(saved.situationStats) },
    opponentModel: { matches: Math.max(0, finite(saved.opponentModel?.matches, 0)), styles: sanitizeNumberMap(saved.opponentModel?.styles), openings: sanitizeNumberMap(saved.opponentModel?.openings), frontal: { contests: Math.max(0, finite(saved.opponentModel?.frontal?.contests, 0)), losses: Math.max(0, finite(saved.opponentModel?.frontal?.losses, 0)) } },
    createdAt: saved.createdAt || base.createdAt
  };
  // Version 2 recorded player wins as AI wins and AI wins as AI losses.
  if (version === 2) {
    merged.wins = Math.max(0, finite(saved.losses, 0));
    merged.losses = Math.max(0, finite(saved.wins, 0));
  }
  const legacyTacticCounters = version < 3;
  TACTICS.forEach((def) => {
    const incoming = saved.tactics?.[def.id];
    if (!incoming || typeof incoming !== 'object') return;
    const baseStat = base.tactics[def.id];
    const params = { ...baseStat.params };
    for (const [key, value] of Object.entries(plainObject(incoming.params))) params[key] = finite(value, baseStat.params[key] ?? 0);
    merged.tactics[def.id] = {
      ...baseStat, ...incoming,
      selections: finite(incoming.selections ?? incoming.uses, 0),
      uses: finite(incoming.uses ?? incoming.selections, 0),
      executions: legacyTacticCounters ? 0 : finite(incoming.executions, 0),
      evaluatedMatches: legacyTacticCounters ? 0 : finite(incoming.evaluatedMatches, 0),
      wins: legacyTacticCounters ? 0 : finite(incoming.wins, 0),
      losses: legacyTacticCounters ? 0 : finite(incoming.losses, 0),
      draws: legacyTacticCounters ? 0 : finite(incoming.draws, 0),
      successes: legacyTacticCounters ? 0 : finite(incoming.successes, 0),
      failures: legacyTacticCounters ? 0 : finite(incoming.failures, 0),
      initialPriority: finite(incoming.initialPriority, def.basePriority),
      priority: Math.max(0.42, Math.min(2.25, finite(incoming.priority, def.basePriority))),
      params,
      contexts: { success: Array.isArray(incoming.contexts?.success) ? incoming.contexts.success.slice(0, 5) : [], failure: Array.isArray(incoming.contexts?.failure) ? incoming.contexts.failure.slice(0, 5) : [] },
      placementStats: sanitizeCounts(incoming.placementStats, ['uses', 'wins', 'losses', 'draws', 'failures']),
      matchups: sanitizeCounts(incoming.matchups, ['uses', 'wins', 'losses', 'draws', 'failures']),
      failureReasons: sanitizeNumberMap(incoming.failureReasons),
      objective: { attempts: Math.max(0, finite(incoming.objective?.attempts, 0)), successes: Math.max(0, finite(incoming.objective?.successes, 0)) },
      lastChange: typeof incoming.lastChange === 'string' ? incoming.lastChange : baseStat.lastChange
    };
  });
  merged.recentChanges = Array.isArray(saved.recentChanges) ? saved.recentChanges.slice(0, 10) : [];
  merged.learningHistory = Array.isArray(saved.learningHistory) ? saved.learningHistory.slice(0, 18) : [];
  merged.recentResults = Array.isArray(saved.recentResults) ? saved.recentResults.filter((r) => ['ai', 'player', 'draw'].includes(r)).slice(-50) : [];
  merged.checkpoints = Array.isArray(saved.checkpoints) ? saved.checkpoints.filter((c) => c && typeof c === 'object' && c.tactics).slice(-6) : [];
  return merged;
}

// ---------------------------------------------------------------------------
// Storage. Every path that would replace stored data first keeps a copy of the
// previous raw value under a backup key, so learning data is never silently lost.
// ---------------------------------------------------------------------------
let lastLoadReport = { status: 'unknown' };
let lastSaveReport = { ok: true, at: null, error: null };
const storageOf = (storage) => storage || globalThis.localStorage;

export function getLoadReport() { return { ...lastLoadReport }; }
export function getSaveReport() { return { ...lastSaveReport }; }

function writeBackup(storage, reason, raw) {
  if (raw == null) return null;
  const key = `${BACKUP_PREFIX}${reason}:${new Date().toISOString()}`;
  try { storage.setItem(key, raw); pruneBackups(storage); return key; } catch { return null; }
}

function storageKeys(storage) {
  const keys = [];
  try {
    if (typeof storage.length === 'number' && typeof storage.key === 'function') { for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i)); }
    else if (storage instanceof Map) keys.push(...storage.keys());
  } catch { /* storage enumeration unsupported */ }
  return keys.filter(Boolean);
}

function pruneBackups(storage) {
  if (typeof storage.removeItem !== 'function') return;
  const backups = storageKeys(storage).filter((key) => key.startsWith(BACKUP_PREFIX)).sort();
  // Migration backups (data from an older release) are always kept.
  const removable = backups.filter((key) => !key.startsWith(`${BACKUP_PREFIX}migration-`));
  while (removable.length > MAX_BACKUPS) { try { storage.removeItem(removable.shift()); } catch { break; } }
}

export function listBackups(storage) {
  const store = storageOf(storage); if (!store) return [];
  return storageKeys(store).filter((key) => key.startsWith(BACKUP_PREFIX)).map((key) => {
    const [, reason = 'backup', ...rest] = key.slice(BACKUP_PREFIX.length).match(/^([^:]+):(.*)$/) || [];
    const at = rest.join(':') || null; let summary = null;
    try { const parsed = parseImport(store.getItem(key)); if (parsed.ok) summary = parsed.summary; } catch { summary = null; }
    return { key, reason, at, summary };
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function loadAI(storage) {
  const store = storageOf(storage);
  let raw = null; let fromLegacy = false;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
    if (raw == null) { raw = store?.getItem(LEGACY_KEY) ?? null; fromLegacy = raw != null; }
  } catch (error) {
    lastLoadReport = { status: 'storage-unavailable', error: error?.name || String(error) };
    return createDefaultAI();
  }
  if (raw == null) { lastLoadReport = { status: 'new' }; return createDefaultAI(); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  if (!parsed || typeof parsed !== 'object' || (!parsed.tactics && ![1, 2, 3, 4].includes(parsed.version))) {
    const backupKey = writeBackup(store, 'corrupt', raw);
    lastLoadReport = { status: 'corrupt', backupKey };
    return createDefaultAI();
  }
  const merged = mergeWithDefaults(parsed);
  if (parsed.version !== DATA_VERSION || fromLegacy) {
    const reason = parsed.version > DATA_VERSION ? 'newer-version' : `migration-v${parsed.version ?? 'unknown'}`;
    const alreadyKept = storageKeys(store).some((key) => key.startsWith(`${BACKUP_PREFIX}${reason}:`));
    const backupKey = alreadyKept ? null : writeBackup(store, reason, raw);
    lastLoadReport = { status: parsed.version > DATA_VERSION ? 'newer-version' : 'migrated', from: parsed.version ?? null, backupKey };
  } else lastLoadReport = { status: 'ok' };
  return merged;
}

export function saveAI(ai, storage) {
  const store = storageOf(storage);
  try {
    const json = JSON.stringify(ai);
    store.setItem(STORAGE_KEY, json);
    const ok = store.getItem(STORAGE_KEY) === json;
    lastSaveReport = { ok, at: new Date().toISOString(), error: ok ? null : 'verify-failed' };
    return ok;
  } catch (error) {
    lastSaveReport = { ok: false, at: new Date().toISOString(), error: error?.name || String(error) };
    return false;
  }
}

export function resetAI(storage) {
  const store = storageOf(storage);
  try { writeBackup(store, 'before-reset', store.getItem(STORAGE_KEY)); } catch { /* nothing to back up */ }
  const fresh = createDefaultAI(); saveAI(fresh, store); return fresh;
}

export function summarizeAI(ai) {
  const tacticsUsed = Object.values(ai.tactics || {}).filter((stat) => (stat.selections || 0) > 0).length;
  return { matches: ai.matches || 0, wins: ai.wins || 0, losses: ai.losses || 0, draws: ai.draws || 0, lastUpdated: ai.lastUpdated || null, tacticsUsed, dataVersion: ai.version };
}

export function exportAI(ai) {
  return JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, dataVersion: DATA_VERSION, exportedAt: new Date().toISOString(), app: 'SUMO 500', data: ai }, null, 2);
}

// Accepts an export file or a raw saved AI object (any supported version).
export function parseImport(text) {
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { ok: false, error: 'JSONとして読み込めません。SUMO 500 のバックアップファイルを選んでください。' }; }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'データが空か、形式が違います。' };
  const payload = parsed.format === EXPORT_FORMAT ? parsed.data : parsed;
  if (!payload || typeof payload !== 'object' || !payload.tactics || typeof payload.tactics !== 'object') return { ok: false, error: 'SUMO 500 の学習データが見つかりません。' };
  if (!TACTICS.some((def) => payload.tactics[def.id])) return { ok: false, error: '戦術データが含まれていません。' };
  if (payload.version > DATA_VERSION) return { ok: false, error: `このアプリより新しい形式（v${payload.version}）です。アプリを更新してから読み込んでください。` };
  const ai = mergeWithDefaults({ version: payload.version ?? 3, ...payload });
  return { ok: true, ai, summary: summarizeAI(ai), exportedAt: parsed.exportedAt || null, sourceVersion: payload.version ?? null };
}

export function importAI(ai, storage) {
  const store = storageOf(storage);
  let backupKey = null;
  try { backupKey = writeBackup(store, 'before-import', store.getItem(STORAGE_KEY)); } catch { backupKey = null; }
  const ok = saveAI(ai, store);
  return { ok, backupKey };
}

export function restoreBackup(key, storage) {
  const store = storageOf(storage);
  const parsed = parseImport(store.getItem(key));
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = importAI(parsed.ai, store);
  return { ...result, ai: parsed.ai };
}

export function matchWinRate(ai) { return ai.matches ? Math.round((ai.wins / ai.matches) * 100) : 0; }
export function successRate(stat) { return stat.evaluatedMatches ? Math.round((stat.wins / stat.evaluatedMatches) * 100) : 0; }
export function objectiveRate(stat) { return stat.objective?.attempts ? Math.round((stat.objective.successes / stat.objective.attempts) * 100) : 0; }
export function tacticById(id) { return TACTICS.find((tactic) => tactic.id === id) || TACTICS[0]; }

export function recordMatchResult(ai, winner, details = {}) {
  if (!['ai', 'player', 'draw'].includes(winner)) return false;
  ai.matches += 1;
  if (winner === 'ai') ai.wins += 1;
  else if (winner === 'player') ai.losses += 1;
  else ai.draws += 1;
  // How the match ended is kept apart from who won: a push-out and a judge
  // decision are different evidence.
  ai.resultBreakdown ||= defaultResultBreakdown();
  const b = ai.resultBreakdown;
  if (details.aiOut && details.playerOut) b.doubleOuts += 1;
  else if (details.playerOut) b.pushOutWins += 1;
  else if (details.aiOut) b.ringOutLosses += 1;
  else if (winner === 'ai') b.judgeWins += 1;
  else if (winner === 'player') b.judgeLosses += 1;
  else b.judgeDraws += 1;
  ai.recentResults ||= []; ai.recentResults.push(winner); ai.recentResults = ai.recentResults.slice(-50);
  return true;
}

export function recordTacticSelection(ai, tacticId) {
  const stat = ai.tactics[tacticId];
  if (!stat) return;
  stat.selections += 1;
  // Keep the legacy field aligned with its historical meaning: selections.
  stat.uses = stat.selections;
}

export function recordTacticExecutions(ai, usageRecords = []) {
  const counted = new Set();
  usageRecords.forEach((usage) => {
    if (!usage.executed || counted.has(usage.tacticId)) return;
    const stat = ai.tactics[usage.tacticId];
    if (!stat) return;
    stat.executions += 1;
    counted.add(usage.tacticId);
  });
  return counted.size;
}

export function recordEscapeOutcome(ai, usage) {
  if (!usage || usage.tacticId !== 'escape') return;
  ai.escapeStats ||= { attempts: 0, recoveries: 0, failures: 0, lastMarginGain: 0 };
  const marginGain = Number((usage.endSelfMargin - usage.startSelfMargin).toFixed(2));
  ai.escapeStats.attempts += 1; ai.escapeStats.lastMarginGain = marginGain;
  if (marginGain >= 10 && usage.minSelfMargin < 55) ai.escapeStats.recoveries += 1;
  else ai.escapeStats.failures += 1;
}

// Intermediate objective of a tactic (e.g. "took the opponent's side", "recovered
// from a side push"). Stored and learned separately from wins: the priority step is
// several times smaller than a match result, and it never counts as a win.
export function recordObjective(ai, usage, contributionWeight = 1) {
  if (!usage || typeof usage.objective !== 'boolean') return null;
  const stat = ai.tactics[usage.tacticId]; if (!stat) return null;
  stat.objective ||= { attempts: 0, successes: 0 };
  stat.objective.attempts += 1; if (usage.objective) stat.objective.successes += 1;
  const weight = Math.max(0.2, Math.min(1, Number(contributionWeight) || 1));
  stat.priority = Math.max(0.42, Math.min(2.25, stat.priority + (usage.objective ? 0.012 : -0.006) * weight));
  let note = usage.objective ? '中間目標 達成 / priority +0.012' : '中間目標 未達 / priority -0.006';
  if (!usage.objective && usage.tacticId === 'pivot') { stat.params.turnBias = Math.max(0.3, Math.min(0.95, stat.params.turnBias + 0.012 * weight)); note += ' / turnBias +'; }
  if (!usage.objective && usage.tacticId === 'flank') { stat.params.preferredDistance = Math.max(150, Math.min(340, stat.params.preferredDistance + 3 * weight)); note += ' / preferredDistance +'; }
  if (!usage.objective && usage.tacticId === 'sidestep') { stat.params.executionTime = Math.max(0.5, Math.min(1.4, stat.params.executionTime - 0.02 * weight)); note += ' / executionTime −'; }
  if (usage.tacticId === 'pivot') { ai.situationStats ||= {}; ai.situationStats.pivotAttempts = (ai.situationStats.pivotAttempts || 0) + 1; if (usage.objective) ai.situationStats.pivotRecoveries = (ai.situationStats.pivotRecoveries || 0) + 1; }
  return { tacticId: usage.tacticId, success: usage.objective, note };
}

function bump(map, key, field) {
  if (!map[key]) map[key] = { uses: 0, wins: 0, losses: 0, draws: 0, failures: 0 };
  map[key].uses ??= 0; map[key].wins ??= 0; map[key].losses ??= 0; map[key].draws ??= 0; map[key].failures ??= 0;
  map[key].uses += 1;
  if (field === 'wins') map[key].wins += 1;
  if (field === 'losses' || field === 'failures') { map[key].losses += 1; map[key].failures += 1; }
  if (field === 'draws') map[key].draws += 1;
}

export function recordOutcome(ai, tacticId, result, context = {}) {
  const stat = ai.tactics[tacticId];
  if (!stat) return;
  const won = result === 'ai' || result === 'win' || result === true;
  const lost = result === 'player' || result === 'loss' || result === false;
  const draw = result === 'draw';
  if (!won && !lost && !draw) return;
  const opening = context.opening || {};
  const placement = opening.placement || 'mid';
  const opponentTactic = context.opponentTactic || context.opponentPattern || 'unknown';
  const failureCause = context.failureCause || (won ? 'clean-read' : draw ? 'draw' : 'read-miss');
  const contributionWeight = Math.max(0.2, Math.min(1, Number(context.contributionWeight ?? 1)));
  const boundedContext = {
    placement, distance: Math.round(context.distance || 0), selfEdge: Math.round(context.selfEdge || 0), opponentEdge: Math.round(context.opponentEdge || 0),
    bladeAdvantage: Number((opening.bladeAdvantage || 0).toFixed(2)), opponentTactic, failureCause,
    selectedSeconds: Number((context.selectedSeconds || 0).toFixed(2)), contactSeconds: Number((context.contactSeconds || 0).toFixed(2)),
    stateChange: Number((context.stateChange || 0).toFixed(3)), progressScore: Number((context.progressScore || 0).toFixed(3))
  };
  const history = won ? stat.contexts.success : lost ? stat.contexts.failure : null;
  if (history) { history.unshift(boundedContext); history.splice(5); }
  stat.evaluatedMatches += 1;
  if (won) { stat.wins += 1; stat.successes += 1; }
  else if (lost) { stat.losses += 1; stat.failures += 1; }
  else stat.draws += 1;
  const resultField = won ? 'wins' : lost ? 'losses' : 'draws';
  bump(stat.placementStats, placement, resultField);
  bump(stat.matchups, opponentTactic, resultField);
  if (lost) stat.failureReasons[failureCause] = (stat.failureReasons[failureCause] || 0) + 1;
  if (!ai.placementStats[placement]) ai.placementStats[placement] = { uses: 0, wins: 0, losses: 0, draws: 0 };
  ai.placementStats[placement].uses ??= 0; ai.placementStats[placement].wins ??= 0; ai.placementStats[placement].losses ??= 0; ai.placementStats[placement].draws ??= 0;
  ai.placementStats[placement].uses += 1;
  if (won) ai.placementStats[placement].wins += 1;
  else if (lost) ai.placementStats[placement].losses += 1;
  else ai.placementStats[placement].draws += 1;

  const def = tacticById(tacticId);
  const oldPriority = stat.priority;
  // A match can contain several meaningful tactics. Attribute the result to each
  // tactic in proportion to its measured contribution instead of selecting one
  // representative tactic, while keeping a minimum evidence floor.
  const outcomeDelta = (won ? 0.055 : lost ? -0.032 : 0) * contributionWeight;
  stat.priority = Math.max(0.42, Math.min(2.25, stat.priority + outcomeDelta));
  let changedParam = draw ? '評価のみ' : 'priority';
  let changeAmount = won ? '+0.055' : lost ? '-0.032' : '±0';
  if (!draw && (failureCause === 'late-turn' || (failureCause !== 'opponent-retreat' && ['zigzag', 'doubleZigzag', 'diagonal'].includes(tacticId)))) {
    stat.params.turnBias = Math.max(0.16, Math.min(0.94, stat.params.turnBias + (won ? -0.008 : 0.014) * contributionWeight));
    stat.params.executionTime = Math.max(0.45, Math.min(1.6, stat.params.executionTime + (failureCause === 'late-turn' ? -0.035 : won ? -0.008 : 0.012) * contributionWeight));
    changedParam = failureCause === 'late-turn' ? 'turnBias / executionTime' : 'turnBias';
    changeAmount = won ? '微減' : '微増';
  } else if (!draw && failureCause === 'opponent-retreat' && ['zigzag', 'flank'].includes(tacticId)) {
    stat.params.preferredDistance = Math.max(150, Math.min(340, stat.params.preferredDistance + (won ? -3 : 6) * contributionWeight));
    changedParam = 'preferredDistance'; changeAmount = won ? '-3' : '+6';
  } else if (!draw && (failureCause === 'edge-risk' || failureCause === 'side-pushed')) {
    stat.params.aggression = Math.max(0.32, Math.min(0.98, stat.params.aggression + (won ? 0.012 : -0.02) * contributionWeight));
    changedParam = 'aggression'; changeAmount = won ? '+0.012' : '-0.020';
  } else if (!draw) {
    stat.params.aggression = Math.max(0.35, Math.min(0.98, stat.params.aggression + (won ? 0.022 : -0.014) * contributionWeight));
    changedParam = 'aggression'; changeAmount = won ? '+0.022' : '-0.014';
  }
  const changed = `${def.name} / ${changedParam} ${changeAmount}`;
  stat.lastChange = changed;
  const event = { tacticId, text: changed, result: won ? 'success' : lost ? 'failure' : 'draw', placement, opponentTactic, failureCause, at: new Date().toISOString() };
  ai.recentChanges.unshift(event); ai.recentChanges = ai.recentChanges.slice(0, 10);
  ai.learningHistory.unshift({ ...boundedContext, tacticId, result: won ? 'success' : lost ? 'failure' : 'draw', changed, at: event.at });
  ai.learningHistory = ai.learningHistory.slice(0, 18);
  return { oldPriority, newPriority: stat.priority, changed, failureCause, placement };
}

function snapshotTactics(ai) {
  const tactics = {};
  for (const [id, stat] of Object.entries(ai.tactics)) tactics[id] = { priority: stat.priority, params: { ...stat.params } };
  return tactics;
}

// A checkpoint every 10 matches lets the player compare and roll back learning.
export function maybeCheckpoint(ai, every = 10) {
  if (!ai.matches || ai.matches % every !== 0) return null;
  ai.checkpoints ||= [];
  if (ai.checkpoints.some((cp) => cp.matches === ai.matches)) return null;
  const window = (ai.recentResults || []).slice(-every);
  const checkpoint = { at: new Date().toISOString(), matches: ai.matches, window: { matches: window.length, wins: window.filter((r) => r === 'ai').length, losses: window.filter((r) => r === 'player').length, draws: window.filter((r) => r === 'draw').length }, tactics: snapshotTactics(ai) };
  ai.checkpoints.push(checkpoint); ai.checkpoints = ai.checkpoints.slice(-6);
  return checkpoint;
}

export function rollbackToCheckpoint(ai, matches, storage) {
  const checkpoint = (ai.checkpoints || []).find((cp) => cp.matches === matches);
  if (!checkpoint) return { ok: false, error: 'チェックポイントが見つかりません。' };
  const store = storageOf(storage);
  try { writeBackup(store, 'before-rollback', JSON.stringify(ai)); } catch { /* best effort */ }
  for (const [id, saved] of Object.entries(checkpoint.tactics)) {
    const stat = ai.tactics[id]; if (!stat) continue;
    stat.priority = finite(saved.priority, stat.priority); stat.params = { ...stat.params, ...saved.params };
  }
  const event = { tacticId: 'system', text: `${checkpoint.matches}戦目の調整値へ戻しました（戦績は保持）`, result: 'draw', placement: '-', opponentTactic: '-', failureCause: 'rollback', at: new Date().toISOString() };
  ai.recentChanges.unshift(event); ai.recentChanges = ai.recentChanges.slice(0, 10);
  return { ok: saveAI(ai, store), checkpoint };
}

export function recentForm(ai, size = 10) {
  const results = ai.recentResults || [];
  const rate = (list) => (list.length ? Math.round((list.filter((r) => r === 'ai').length / list.length) * 100) : null);
  const recent = results.slice(-size); const previous = results.slice(-size * 2, -size);
  return { recent: rate(recent), previous: rate(previous), recentCount: recent.length, previousCount: previous.length };
}

// Everything the app does with a finished match, in one testable place.
export function applyMatchLearning(ai, outcome) {
  recordMatchResult(ai, outcome.winner, outcome);
  recordTacticExecutions(ai, outcome.tacticUsage);
  const style = outcome.opponentStyle || outcome.opponentTactic || 'unknown';
  const context = { distance: outcome.distance, selfEdge: outcome.selfEdge, opponentEdge: outcome.opponentEdge, opening: outcome.opening, opponentTactic: style, failureCause: outcome.failureCause };
  const evaluated = outcome.tacticUsage?.filter((usage) => usage.executed) || [];
  const totalContribution = evaluated.reduce((sum, usage) => sum + usage.score, 0);
  const weightOf = (usage) => (totalContribution > 0 ? usage.score / totalContribution : 1 / evaluated.length);
  evaluated.filter((usage) => usage.tacticId === 'escape').forEach((usage) => recordEscapeOutcome(ai, usage));
  const changes = evaluated.map((usage) => recordOutcome(ai, usage.tacticId, outcome.winner, {
    ...context, selectedSeconds: usage.selectedSeconds, contactSeconds: usage.contactSeconds, stateChange: usage.stateChange,
    progressScore: usage.progressScore, contributionWeight: weightOf(usage)
  })).filter(Boolean);
  const objectives = evaluated.map((usage) => recordObjective(ai, usage, weightOf(usage))).filter(Boolean);
  // What the AI learned about its (single) human opponent.
  ai.opponentModel ||= { matches: 0, styles: {}, openings: {} };
  ai.opponentModel.matches += 1;
  if (style) ai.opponentModel.styles[style] = (ai.opponentModel.styles[style] || 0) + 1;
  if (outcome.openingMove) ai.opponentModel.openings[outcome.openingMove] = (ai.opponentModel.openings[outcome.openingMove] || 0) + 1;
  // Head-on strength of the opponent: a contest counts when the blades were locked
  // for a while, a loss when the AI was driven back during it.
  if ((outcome.events?.frontalSeconds || 0) > 0.8) {
    ai.opponentModel.frontal ||= { contests: 0, losses: 0 };
    ai.opponentModel.frontal.contests += 1;
    if ((outcome.events?.frontalLossEpisodes || 0) > 0) ai.opponentModel.frontal.losses += 1;
  }
  ai.situationStats ||= {};
  for (const key of ['sideHitSeconds', 'sidePressureSeconds', 'sideEpisodes', 'frontalLossSeconds']) ai.situationStats[key] = Number(((ai.situationStats[key] || 0) + (outcome.events?.[key] || 0)).toFixed(2));
  const checkpoint = maybeCheckpoint(ai);
  ai.lastUpdated = new Date().toISOString();
  return { changes, objectives, checkpoint };
}

export function getAILevel(ai) {
  if (ai.matches < 3) return '起動直後';
  if (ai.matches < 8) return '学習中';
  if (ai.matches < 18) return '適応中';
  return '熟練調整';
}
