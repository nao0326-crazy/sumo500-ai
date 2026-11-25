import './styles.css';
import { BattleSimulation } from './game.js';
import { getAILevel, loadAI, matchWinRate, recordEscapeOutcome, recordMatchResult, recordOutcome, recordTacticExecutions, resetAI, saveAI, successRate, TACTICS, PLACEMENT_LABELS } from './data.js';

const app = document.querySelector('#app');
let ai = loadAI();
let currentScreen = 'home';
let battle = null;
let result = null;
let battleStartCount = 0;

const routePaths = { home: '/', battle: '/battle', result: '/result', growth: '/growth' };
const screenFromPath = () => ({ '/': 'home', '/battle': 'battle', '/result': 'result', '/growth': 'growth' }[window.location.pathname] || 'home');
currentScreen = screenFromPath();

function navigate(target) {
  const path = routePaths[target] || '/';
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  if (battle && target !== 'battle') battle.stop();
  battle = null;
  currentScreen = target;
  render();
}

const fmtDate = (iso) => iso ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : 'まだ記録なし';
const pct = (value) => `${value}%`;
const escapeHTML = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function shell(content, active = currentScreen) {
  return `<div class="app-shell">
    <header class="topbar">
      <button class="brand-button" data-nav="home" aria-label="ホームへ戻る"><span class="brand-mark">S</span><span><strong>SUMO</strong> <em>500</em></span></button>
      <div class="topbar-right"><span class="status-dot"></span><span class="status-label">LOCAL / READY</span><button class="icon-button" data-nav="growth" aria-label="AI成長状況">⌁</button></div>
    </header>
    <main class="main-content">${content}</main>
    <nav class="bottom-nav" aria-label="メインナビゲーション">
      <button class="nav-item ${active === 'home' ? 'active' : ''}" data-nav="home"><span>⌂</span><small>ホーム</small></button>
      <button class="nav-item ${active === 'battle' ? 'active' : ''}" data-nav="battle"><span>◎</span><small>対戦</small></button>
      <button class="nav-item ${active === 'growth' ? 'active' : ''}" data-nav="growth"><span>▥</span><small>成長</small></button>
    </nav>
  </div>`;
}

function render() {
  if (currentScreen === 'home') renderHome();
  if (currentScreen === 'battle') renderBattle();
  if (currentScreen === 'result') renderResult();
  if (currentScreen === 'growth') renderGrowth();
}

function renderHome() {
  const winRate = matchWinRate(ai);
  app.innerHTML = shell(`<section class="home-screen">
    <div class="hero-kicker"><span class="live-pill"><i></i> オフライン対戦可能</span><span class="eyebrow">ROBOT SUMO / 500g CLASS</span></div>
    <div class="hero-copy"><h1>押し出せ。<br><span>読み合え。</span></h1><p>左右の車輪を別々に操り、土俵の一手を体験する。<br>AIも、あなたとの対戦から少しずつ変わっていく。</p></div>
    <div class="home-arena-preview"><div class="preview-ring"><span class="preview-center">500<br><small>CLASS</small></span><span class="mini-bot bot-a">▲</span><span class="mini-bot bot-b">▲</span></div><div class="scanline"></div><div class="preview-label">LOCAL ARENA <b>01</b></div></div>
    <button class="primary-cta" data-action="start-battle"><span class="cta-icon">▶</span><span><strong>対戦を開始</strong><small>AIロボット「KOMA」と出撃</small></span><b>→</b></button>
    <div class="metric-row"><div><strong>${ai.matches}</strong><span>対戦回数</span></div><div><strong>${ai.wins}<i>W</i> / ${ai.losses}<i>L</i></strong><span>AI戦績</span></div><div><strong>${winRate}<i>%</i></strong><span>AI勝率</span></div></div>
    <div class="home-section-head"><span>AI PROFILE</span><button data-nav="growth">詳細を見る →</button></div>
    <div class="profile-card"><div class="avatar-ring"><span>⌁</span></div><div class="profile-main"><strong>KOMA <span class="level-tag">${getAILevel(ai)}</span></strong><p>戦術を${TACTICS.length}つ習得済み <i>•</i> 優先度を適応中</p></div><div class="profile-arrow">›</div></div>
    <p class="offline-note"><span>◉</span> 学習データはこの端末に保存されます。通信不要。</p>
  </section>`);
  bindCommon();
}

function renderBattle() {
  app.innerHTML = shell(`<section class="battle-screen">
    <div class="battle-topline"><button class="back-button" data-action="leave-battle">‹ <span>ホーム</span></button><div class="round-label">ROUND <strong>01</strong></div><div class="timer" data-time>00:00</div></div>
    <div class="battle-status"><div class="combatant"><span class="combatant-dot player-dot"></span><strong>YOU</strong><small>MANUAL</small></div><div class="versus">VS</div><div class="combatant ai-combatant"><span class="combatant-dot ai-dot"></span><strong>KOMA</strong><small data-tactic>正面突破</small></div></div>
    <div class="canvas-wrap"><canvas id="arena-canvas" aria-label="ロボット相撲の土俵"></canvas><div class="arena-hint">相手の輪郭を土俵の外へ</div></div>
    <div class="tactic-readout"><span class="readout-pulse"></span><span>AI TACTIC</span><strong data-tactic-readout>直進 / 正面突破</strong><small data-opening>配置 —</small><small data-distance>距離 —</small></div>
    <div class="control-panel"><div class="stick-labels"><span>LEFT WHEEL</span><span>RIGHT WHEEL</span></div><div class="sticks"><div class="stick-zone" data-stick="left"><div class="stick-base"><div class="stick-ticks"></div><div class="stick-knob"><span></span></div></div><small>上下で左輪を操作</small></div><div class="drive-glyph">↕</div><div class="stick-zone" data-stick="right"><div class="stick-base"><div class="stick-ticks"></div><div class="stick-knob"><span></span></div></div><small>上下で右輪を操作</small></div></div></div>
  </section>`, 'battle');
  bindCommon();
  const canvas = document.querySelector('#arena-canvas');
  battle = new BattleSimulation(canvas, ai, {
    onUpdate: updateBattleHUD,
    onFinish: handleFinish
  });
  requestAnimationFrame(() => battle?.resize());
  bindStick(document.querySelector('[data-stick="left"]'), 'left');
  bindStick(document.querySelector('[data-stick="right"]'), 'right');
  battleStartCount += 1;
  battle.start();
}

function updateBattleHUD(snapshot) {
  const time = document.querySelector('[data-time]');
  const tactic = document.querySelector('[data-tactic]');
  const tacticReadout = document.querySelector('[data-tactic-readout]');
  const opening = document.querySelector('[data-opening]');
  const distance = document.querySelector('[data-distance]');
  if (!time) return;
  const seconds = Math.floor(snapshot.time);
  time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  tactic.textContent = snapshot.tacticName;
  tacticReadout.textContent = snapshot.tacticName;
  if (opening) opening.textContent = `配置 ${PLACEMENT_LABELS[snapshot.placement] || snapshot.placement}`;
  distance.textContent = `距離 ${snapshot.distance}`;
  document.body.classList.toggle('countdown-active', snapshot.countdown > 0);
}

function bindStick(zone, side) {
  const knob = zone.querySelector('.stick-knob');
  let activePointer = null;
  const update = (event) => {
    const rect = zone.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const value = Math.max(-1, Math.min(1, -(event.clientY - center) / (rect.height * 0.34)));
    knob.style.transform = `translate(-50%, ${-value * 34}px)`;
    battle?.setInput(side, value);
    zone.classList.toggle('engaged', Math.abs(value) > 0.05);
  };
  const reset = () => {
    activePointer = null;
    knob.style.transform = 'translate(-50%, 0)';
    zone.classList.remove('engaged');
    battle?.setInput(side, 0);
  };
  zone.addEventListener('pointerdown', (event) => { activePointer = event.pointerId; zone.setPointerCapture(event.pointerId); update(event); });
  zone.addEventListener('pointermove', (event) => { if (event.pointerId === activePointer) update(event); });
  zone.addEventListener('pointerup', reset);
  zone.addEventListener('pointercancel', reset);
  zone.addEventListener('lostpointercapture', reset);
}

function handleFinish(outcome) {
  const aiWon = outcome.winner === 'ai';
  const draw = outcome.winner === 'draw';
  recordMatchResult(ai, outcome.winner);
  recordTacticExecutions(ai, outcome.tacticUsage);
  const context = { distance: outcome.distance, selfEdge: outcome.selfEdge, opponentEdge: outcome.opponentEdge, opening: outcome.opening, opponentTactic: outcome.opponentTactic, failureCause: outcome.failureCause };
  const evaluated = outcome.tacticUsage?.filter((usage) => usage.executed) || [];
  const totalContribution = evaluated.reduce((sum, usage) => sum + usage.score, 0);
  evaluated.filter((usage) => usage.tacticId === 'escape').forEach((usage) => recordEscapeOutcome(ai, usage));
  const changes = evaluated.map((usage) => recordOutcome(ai, usage.tacticId, outcome.winner, {
    ...context,
    selectedSeconds: usage.selectedSeconds,
    contactSeconds: usage.contactSeconds,
    stateChange: usage.stateChange,
    progressScore: usage.progressScore,
    contributionWeight: totalContribution > 0 ? usage.score / totalContribution : 1 / evaluated.length
  })).filter(Boolean);
  const changed = changes[0] || { changed: '評価条件を満たす戦術実行なし（勝敗のみ記録）' };
  ai.lastUpdated = new Date().toISOString();
  saveAI(ai);
  result = { ...outcome, changed, aiWon, draw };
  setTimeout(() => { navigate('result'); }, 320);
}

function renderResult() {
  if (!result) { navigate('home'); return; }
  const title = result.winner === 'player' ? '押し出し成功' : result.winner === 'ai' ? '土俵際で敗北' : '同時に場外';
  const kicker = result.winner === 'player' ? 'YOU TAKE THE RING' : result.winner === 'ai' ? 'KOMA TAKES THE RING' : 'DOUBLE RING OUT';
  const tone = result.winner === 'player' ? 'win' : result.winner === 'ai' ? 'loss' : 'draw';
  const detail = result.winner === 'player' ? '相手の重心を外へ運びました。' : result.winner === 'ai' ? 'KOMAが選んだ一手が、今回は上回りました。' : '二体の軌道が重なり、ほぼ同時に場外へ出ました。';
  const openingLabel = PLACEMENT_LABELS[result.opening?.placement] || result.opening?.placement || '中距離';
  app.innerHTML = shell(`<section class="result-screen"><div class="result-kicker ${tone}">${kicker}</div><div class="result-burst ${tone}"><span class="burst-line line-one"></span><span class="burst-line line-two"></span><div class="result-symbol">${result.winner === 'player' ? 'W' : result.winner === 'ai' ? 'L' : '＝'}</div></div><h1>${title}</h1><p class="result-detail">${detail}</p><div class="result-stats"><div><span>対戦時間</span><strong>${Math.floor(result.time)}<small> sec</small></strong></div><div><span>最後のAI戦術</span><strong class="tactic-result">${escapeHTML(result.tacticName)}</strong></div><div><span>初動配置</span><strong>${escapeHTML(openingLabel)}</strong></div></div><div class="learning-callout"><span class="callout-icon">⌁</span><div><strong>AIの調整メモ</strong><p>${result.changed?.changed || '戦術データを記録しました。'} 配置「${escapeHTML(openingLabel)}」で相手の${escapeHTML(result.opponentTactic || '動き')}を記録し、${escapeHTML(result.failureCause || '結果')}として次回の相性判断へ反映します。</p></div></div><div class="result-actions"><button class="primary-cta compact" data-action="rematch"><span class="cta-icon">↻</span><span><strong>もう一度対戦</strong><small>同じAIが学習を続けます</small></span><b>→</b></button><button class="secondary-cta" data-nav="growth">AIの成長を見る <span>→</span></button></div></section>`, 'result');
  bindCommon();
}

function renderGrowth() {
  const totalSelections = TACTICS.reduce((sum, def) => sum + ai.tactics[def.id].selections, 0);
  const totalExecutions = TACTICS.reduce((sum, def) => sum + ai.tactics[def.id].executions, 0);
  const winRate = matchWinRate(ai);
  const rows = TACTICS.map((def) => {
    const stat = ai.tactics[def.id];
    const rate = successRate(stat);
    return `<div class="tactic-row"><div class="tactic-name"><span style="--tactic-color:${def.color}">${def.icon}</span><div><strong>${def.name}</strong><small>${def.pattern}</small></div></div><div class="tactic-number"><strong>${stat.selections}</strong><small>選択 / 実行 ${stat.executions}</small></div><div class="tactic-rate"><strong>${pct(rate)}</strong><div class="rate-bar"><i style="width:${Math.max(4, rate)}%;background:${def.color}"></i></div><small>${stat.wins}勝 ${stat.losses}敗 ${stat.draws}分 / ${stat.evaluatedMatches}評価</small></div><div class="tactic-priority"><strong>${stat.priority.toFixed(2)}</strong><small>優先度</small></div></div>`;
  }).join('');
  const recent = ai.recentChanges.length ? ai.recentChanges.slice(0, 5).map((item) => `<li><span class="change-dot ${item.result}"></span><div><strong>${escapeHTML(item.text)}</strong><small>${escapeHTML(item.placement || '配置')} / 相手:${escapeHTML(item.opponentTactic || '不明')} / ${fmtDate(item.at)}</small></div></li>`).join('') : '<li class="empty-change">対戦すると、ここに調整履歴が表示されます。</li>';
  app.innerHTML = shell(`<section class="growth-screen"><div class="page-heading"><div><span class="eyebrow">AI DEVELOPMENT / LOCAL LOG</span><h1>成長状況</h1><p>KOMAは勝敗だけでなく、戦術ごとの結果から少しずつ変化します。</p></div><div class="level-orb"><span>${getAILevel(ai).slice(0, 2)}</span><small>STATUS</small></div></div><div class="growth-overview"><div><span>対戦</span><strong>${ai.matches}</strong><small>matches</small></div><div><span>勝利</span><strong>${ai.wins}</strong><small>AI win</small></div><div><span>勝率</span><strong>${winRate}<i>%</i></strong><small>adaptive</small></div><div><span>戦術実行</span><strong>${totalExecutions}</strong><small>${totalSelections} selections</small></div></div><div class="section-title"><span>TACTIC MATRIX</span><small>成功率 / 優先度</small></div><div class="tactic-table">${rows}</div><div class="growth-columns"><div class="insight-card"><div class="card-heading"><span>RECENT ADJUSTMENTS</span><span class="live-pill tiny"><i></i> LOCAL</span></div><ul class="change-list">${recent}</ul></div><div class="insight-card"><div class="card-heading"><span>LEARNING RULE</span></div><p class="learning-copy">実行条件を満たした各戦術へ、稼働時間＋接触時間×2.5の貢献度に応じて勝敗を評価します。複数戦術を使った試合でも、一つの戦術へ勝敗を丸ごと帰属させず、根拠が薄い戦術の更新は小さくします。評価率は評価試合数を分母とし、引き分けも分母に含めます。</p><div class="meter-label"><span>学習の安定性</span><strong>SMOOTH</strong></div><div class="stability-meter"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div><div class="reset-area"><button class="text-button" data-action="reset-ai">学習データを初期化</button><span>この端末のlocalStorageだけを初期化します</span></div></section>`, 'growth');
  const placementOrder = ['edge', 'corner', 'close', 'mid', 'open'];
  const escapeAttempts = ai.escapeStats?.attempts || 0;
  const escapeRecoveryRate = escapeAttempts ? Math.round(((ai.escapeStats?.recoveries || 0) / escapeAttempts) * 100) : 0;
  const placementSummary = placementOrder.map((key) => { const item = ai.placementStats[key] || { uses: 0, wins: 0, losses: 0 }; const rate = item.uses ? Math.round((item.wins / item.uses) * 100) : 0; return `<div class="placement-chip"><span>${escapeHTML(PLACEMENT_LABELS[key] || key)}</span><strong>${item.uses}</strong><small>${rate}% win</small></div>`; }).join('');
  const historySummary = ai.learningHistory.length ? ai.learningHistory.slice(0, 4).map((item) => `<li><span class="change-dot ${item.result}"></span><div><strong>${escapeHTML(item.tacticId)} · ${escapeHTML(item.changed)}</strong><small>配置:${escapeHTML(item.placement)} / 相手:${escapeHTML(item.opponentTactic)} / 原因:${escapeHTML(item.failureCause)}</small></div></li>`).join('') : '<li class="empty-change">初回対戦後に配置別の読み合いログが蓄積されます。</li>';
  const table = document.querySelector('.tactic-table');
  table?.insertAdjacentHTML('afterend', `<div class="opening-insight"><div class="card-heading"><span>OPENING READ / PLACEMENT TENDENCY</span><span class="live-pill tiny"><i></i> RULE-BASED</span></div><p>初期配置から候補を絞り、相手の動きは確率として残します。優先度は初期値との差分を小さく更新します。</p><div class="placement-grid">${placementSummary}</div><ul class="change-list">${historySummary}</ul></div>`);
  table?.insertAdjacentHTML('afterend', `<div class="opening-insight"><div class="card-heading"><span>ESCAPE RECOVERY / FOOTPRINT MARGIN</span><span class="live-pill tiny"><i></i> INDEPENDENT</span></div><p>Escapeの回復判定は試合の勝敗と分け、機体全体の土俵余裕が増えたかで評価します。</p><div class="placement-grid"><div class="placement-chip"><span>脱出試行</span><strong>${escapeAttempts}</strong><small>${ai.escapeStats?.recoveries || 0}回回復</small></div><div class="placement-chip"><span>回復率</span><strong>${escapeRecoveryRate}%</strong><small>余裕改善ベース</small></div></div></div>`);
  document.querySelectorAll('.tactic-priority').forEach((cell, index) => { const stat = ai.tactics[TACTICS[index].id]; const delta = stat.priority - stat.initialPriority; cell.querySelector('small').textContent = `初期比 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`; });
  bindCommon();
}

function bindCommon() {
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => {
    const target = button.dataset.nav;
    navigate(target);
  }));
  document.querySelectorAll('[data-action="start-battle"], [data-action="rematch"]').forEach((button) => button.addEventListener('click', () => {
    if (battle) battle.stop();
    result = null;
    navigate('battle');
  }));
  document.querySelectorAll('[data-action="leave-battle"]').forEach((button) => button.addEventListener('click', () => {
    battle?.stop(); navigate('home');
  }));
  document.querySelectorAll('[data-action="reset-ai"]').forEach((button) => button.addEventListener('click', () => {
    if (window.confirm('AIの対戦回数・戦術ログ・調整値を初期化しますか？')) {
      ai = resetAI();
      renderGrowth();
    }
  }));
}

window.addEventListener('resize', () => battle?.resize());
window.addEventListener('beforeunload', () => battle?.stop());
window.addEventListener('popstate', () => { if (battle) battle.stop(); battle = null; currentScreen = screenFromPath(); render(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
render();
