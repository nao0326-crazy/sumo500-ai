const STORAGE_KEY = 'sumo500-ai-v2';

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
  }
];

function defaultTactic(def) {
  return {
    uses: 0, selections: 0, executions: 0, evaluatedMatches: 0, wins: 0, losses: 0, draws: 0,
    successes: 0, failures: 0, initialPriority: def.basePriority, priority: def.basePriority,
    params: { ...def.defaultParams }, contexts: { success: [], failure: [] },
    placementStats: {}, matchups: {}, failureReasons: {}, lastChange: '初期値'
  };
}

export function createDefaultAI() {
  const tactics = {};
  TACTICS.forEach((def) => { tactics[def.id] = defaultTactic(def); });
  return {
    version: 3, matches: 0, wins: 0, losses: 0, draws: 0, tactics,
    escapeStats: { attempts: 0, recoveries: 0, failures: 0, lastMarginGain: 0 },
    placementStats: {}, recentChanges: [], learningHistory: [], lastUpdated: null
  };
}

function mergeWithDefaults(saved) {
  const base = createDefaultAI();
  if (!saved || ![1, 2, 3].includes(saved.version)) return base;
  const merged = { ...base, ...saved, version: 3, tactics: { ...base.tactics }, placementStats: saved.placementStats || {}, escapeStats: { ...base.escapeStats, ...(saved.escapeStats || {}) } };
  // Version 2 recorded player wins as AI wins and AI wins as AI losses.
  if (saved.version === 2) {
    merged.wins = saved.losses ?? 0;
    merged.losses = saved.wins ?? 0;
  }
  const legacyTacticCounters = saved.version < 3;
  TACTICS.forEach((def) => {
    const incoming = saved.tactics?.[def.id];
    if (!incoming) return;
    merged.tactics[def.id] = {
      ...base.tactics[def.id], ...incoming,
      selections: incoming.selections ?? incoming.uses ?? 0,
      uses: incoming.uses ?? incoming.selections ?? 0,
      executions: legacyTacticCounters ? 0 : incoming.executions ?? 0,
      evaluatedMatches: legacyTacticCounters ? 0 : incoming.evaluatedMatches ?? 0,
      wins: legacyTacticCounters ? 0 : incoming.wins ?? 0,
      losses: legacyTacticCounters ? 0 : incoming.losses ?? 0,
      draws: legacyTacticCounters ? 0 : incoming.draws ?? 0,
      successes: legacyTacticCounters ? 0 : incoming.successes ?? 0,
      failures: legacyTacticCounters ? 0 : incoming.failures ?? 0,
      initialPriority: incoming.initialPriority ?? def.basePriority,
      params: { ...base.tactics[def.id].params, ...(incoming.params || {}) },
      contexts: { success: incoming.contexts?.success || [], failure: incoming.contexts?.failure || [] },
      placementStats: incoming.placementStats || {}, matchups: incoming.matchups || {}, failureReasons: incoming.failureReasons || {}
    };
  });
  merged.recentChanges = Array.isArray(saved.recentChanges) ? saved.recentChanges.slice(0, 10) : [];
  merged.learningHistory = Array.isArray(saved.learningHistory) ? saved.learningHistory.slice(0, 18) : [];
  return merged;
}

export function loadAI() {
  try { return mergeWithDefaults(JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('sumo500-ai-v1') || 'null')); }
  catch { return createDefaultAI(); }
}
export function saveAI(ai) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ai)); } catch { /* local persistence is best effort */ } }
export function resetAI() { const fresh = createDefaultAI(); saveAI(fresh); return fresh; }
export function matchWinRate(ai) { return ai.matches ? Math.round((ai.wins / ai.matches) * 100) : 0; }
export function successRate(stat) { return stat.evaluatedMatches ? Math.round((stat.wins / stat.evaluatedMatches) * 100) : 0; }
export function tacticById(id) { return TACTICS.find((tactic) => tactic.id === id) || TACTICS[0]; }

export function recordMatchResult(ai, winner) {
  if (!['ai', 'player', 'draw'].includes(winner)) return false;
  ai.matches += 1;
  if (winner === 'ai') ai.wins += 1;
  else if (winner === 'player') ai.losses += 1;
  else ai.draws += 1;
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
  } else if (!draw && failureCause === 'edge-risk') {
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

export function getAILevel(ai) {
  if (ai.matches < 3) return '起動直後';
  if (ai.matches < 8) return '学習中';
  if (ai.matches < 18) return '適応中';
  return '熟練調整';
}
