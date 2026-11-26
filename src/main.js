import './styles.css';
import playerSprite from './assets/robot-player.webp';
import aiSprite from './assets/robot-ai.webp';
import { BattleSimulation } from './game.js';
import {
  applyMatchLearning, exportAI, getAILevel, getLoadReport, getSaveReport, importAI, listBackups, loadAI, matchWinRate,
  objectiveRate, parseImport, PLACEMENT_LABELS, recentForm, resetAI, restoreBackup, rollbackToCheckpoint, saveAI, successRate,
  summarizeAI, TACTICS, tacticById
} from './data.js';
import { loadSettings, saveSettings, shapeStick } from './settings.js';
import { checkForUpdate, pwaState, registerServiceWorker, requestPersistentStorage, storageStatus } from './pwa.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const RESULT_KEY = 'sumo500-last-result';
const app = document.querySelector('#app');
let ai = loadAI();
let settings = loadSettings();
let currentScreen = 'home';
let battle = null;
let result = null;
let pendingUpdate = false;
const startupReport = getLoadReport();

const routePaths = { home: '/', battle: '/battle', result: '/result', growth: '/growth', settings: '/settings', backup: '/backup' };
const screenFromPath = () => (Object.entries(routePaths).find(([, path]) => path === window.location.pathname)?.[0]) || 'home';

const fmtDate = (iso) => iso ? new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : 'まだ記録なし';
const pct = (value) => (value === null || value === undefined ? '—' : `${value}%`);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const bytes = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const vibrate = (pattern) => { if (settings.vibration && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } } };

const STYLE_LABELS = { direct: '直進', retreat: '後退', zigzag: '旋回', wait: '待ち', unknown: '不明' };
const OPENING_LABELS = { charge: '突進', retreat: '後退', turn: '旋回', wait: '待ち' };
const CAUSE_LABELS = { 'clean-read': '読み勝ち', 'pressure-success': '押し切り', 'edge-risk': '土俵際', 'side-pushed': '横押し', 'opponent-retreat': '相手の後退', 'late-turn': '方向転換遅れ', 'out-pushed': '正面で押し負け', 'read-miss': '読み外し', draw: '引き分け', rollback: '巻き戻し' };
const BACKUP_LABELS = { 'before-import': 'インポート前', 'before-reset': '初期化前', 'before-rollback': '巻き戻し前', corrupt: '破損データの退避', 'newer-version': '新しい形式のデータ' };
const backupLabel = (reason) => BACKUP_LABELS[reason] || (reason.startsWith('migration-') ? `旧形式（${reason.slice(10)}）からの移行前` : reason);

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function persistAI() {
  const ok = saveAI(ai);
  if (!ok) showToast('学習データを保存できませんでした。端末の空き容量やブラウザ設定を確認してください。', { tone: 'danger', duration: 6000 });
  return ok;
}

function storeResult(value) {
  try { sessionStorage.setItem(RESULT_KEY, JSON.stringify(value)); } catch { /* session copy is only for reloads */ }
}
function restoreResult() {
  try { return JSON.parse(sessionStorage.getItem(RESULT_KEY) || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Modal and toast
// ---------------------------------------------------------------------------
function showModal({ title, body, confirmLabel = 'OK', cancelLabel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${escapeHTML(title)}</h2><div class="modal-body">${body}</div><div class="modal-actions">${cancelLabel ? `<button class="modal-cancel" type="button">${escapeHTML(cancelLabel)}</button>` : ''}<button class="modal-confirm ${danger ? 'danger' : ''}" type="button">${escapeHTML(confirmLabel)}</button></div></div>`;
    const close = (value) => { overlay.remove(); document.removeEventListener('keydown', onKey); previous?.focus?.(); resolve(value); };
    const onKey = (event) => { if (event.key === 'Escape') close(false); };
    overlay.querySelector('.modal-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector(cancelLabel ? '.modal-cancel' : '.modal-confirm').focus();
  });
}

function showToast(message, { tone = 'info', duration = 3600, action = null } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<span>${escapeHTML(message)}</span>${action ? `<button type="button">${escapeHTML(action.label)}</button>` : ''}`;
  if (action) toast.querySelector('button').addEventListener('click', () => { toast.remove(); action.run(); });
  host.appendChild(toast);
  if (duration) setTimeout(() => toast.remove(), duration);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function battleInProgress() { return Boolean(battle && !battle.ended); }

function leaveBattle() {
  if (!battle) return;
  battle.stop();
  if (!battle.ended) persistAI(); // keep the tactic-selection counts of an abandoned match
  battle = null;
}

async function confirmLeaveBattle() {
  if (!battleInProgress()) return true;
  const wasPaused = battle.paused; battle.pause();
  const ok = await showModal({ title: '対戦を中断しますか？', body: '<p>この対戦の勝敗は記録されません。AIの学習データはそのまま残ります。</p>', confirmLabel: '中断する', cancelLabel: '続ける' });
  if (!ok && battle && !wasPaused) battle.resume();
  return ok;
}

async function navigate(target, { replace = false, skipGuard = false } = {}) {
  if (!skipGuard && currentScreen === 'battle' && target !== 'battle' && !(await confirmLeaveBattle())) return;
  const path = routePaths[target] || '/';
  if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({ screen: target }, '', path);
  else if (replace) window.history.replaceState({ screen: target }, '', path);
  leaveBattle();
  currentScreen = target;
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', async () => {
  const target = screenFromPath();
  if (currentScreen === 'battle' && battleInProgress() && target !== 'battle') {
    // Back button during a match: stay on the battle URL until the player confirms.
    window.history.pushState({ screen: 'battle' }, '', routePaths.battle);
    if (await confirmLeaveBattle()) navigate(target, { replace: true, skipGuard: true });
    return;
  }
  leaveBattle();
  currentScreen = target;
  render();
});

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function shell(content, active = currentScreen) {
  const saveFailed = getSaveReport().ok === false;
  return `<div class="app-shell ${active === 'battle' ? 'battle-mode' : ''}">
    <header class="topbar">
      <button class="brand-button" data-nav="home" aria-label="ホームへ戻る"><span class="brand-mark">S</span><span><strong>SUMO</strong> <em>500</em></span></button>
      <div class="topbar-right"><span class="status-dot ${saveFailed ? 'warn' : ''}"></span><span class="status-label">${saveFailed ? 'SAVE ERROR' : navigator.onLine === false ? 'OFFLINE' : 'LOCAL'}</span><button class="icon-button" data-nav="settings" aria-label="設定">⚙</button></div>
    </header>
    <main class="main-content">${content}</main>
    <nav class="bottom-nav" aria-label="メインナビゲーション">
      <button class="nav-item ${active === 'home' ? 'active' : ''}" data-nav="home"><span>⌂</span><small>ホーム</small></button>
      <button class="nav-item ${active === 'battle' ? 'active' : ''}" data-action="start-battle"><span>◎</span><small>対戦</small></button>
      <button class="nav-item ${active === 'growth' ? 'active' : ''}" data-nav="growth"><span>▥</span><small>成長</small></button>
      <button class="nav-item ${['settings', 'backup'].includes(active) ? 'active' : ''}" data-nav="settings"><span>⚙</span><small>設定</small></button>
    </nav>
  </div>`;
}

function render() {
  document.body.classList.toggle('in-battle', currentScreen === 'battle');
  if (currentScreen === 'home') renderHome();
  else if (currentScreen === 'battle') renderBattle();
  else if (currentScreen === 'result') renderResult();
  else if (currentScreen === 'growth') renderGrowth();
  else if (currentScreen === 'settings') renderSettings();
  else if (currentScreen === 'backup') renderBackup();
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function renderHome() {
  const winRate = matchWinRate(ai);
  const form = recentForm(ai);
  app.innerHTML = shell(`<section class="home-screen">
    <div class="hero-kicker"><span class="live-pill"><i></i> オフライン対戦可能</span><span class="eyebrow">ROBOT SUMO / 500g CLASS</span></div>
    <div class="hero-copy"><h1>押し出せ。<br><span>読み合え。</span></h1><p>左右の車輪を別々に操り、土俵の一手を体験する。<br>AIも、あなたとの対戦から少しずつ変わっていく。</p></div>
    <div class="home-arena-preview" aria-hidden="true"><div class="preview-ring"><span class="preview-center">500<br><small>CLASS</small></span><span class="mini-bot bot-a">▲</span><span class="mini-bot bot-b">▲</span></div><div class="scanline"></div><div class="preview-label">LOCAL ARENA <b>01</b></div></div>
    <button class="primary-cta" data-action="start-battle"><span class="cta-icon">▶</span><span><strong>対戦を開始</strong><small>AIロボット「KOMA」と出撃</small></span><b>→</b></button>
    <div class="metric-row"><div><strong>${ai.matches}</strong><span>対戦回数</span></div><div><strong>${ai.wins}<i>W</i> / ${ai.losses}<i>L</i></strong><span>AI戦績（${ai.draws}分）</span></div><div><strong>${winRate}<i>%</i></strong><span>AI勝率${form.recentCount >= 5 ? ` · 直近${form.recentCount}戦 ${form.recent}%` : ''}</span></div></div>
    <div class="home-section-head"><span>AI PROFILE</span><button data-nav="growth">詳細を見る →</button></div>
    <button class="profile-card" data-nav="growth"><div class="avatar-ring"><span>⌁</span></div><div class="profile-main"><strong>KOMA <span class="level-tag">${getAILevel(ai)}</span></strong><p>戦術を${TACTICS.length}つ保有 <i>•</i> 横押し・押し負けに反応 <i>•</i> 対戦ごとに学習</p></div><div class="profile-arrow">›</div></button>
    <div class="howto-card"><strong>操作</strong><p>左スティック＝左車輪、右スティック＝右車輪。上で前進、下で後退、離すと停止。両方上で直進、片方だけで旋回。</p></div>
    <p class="offline-note"><span>◉</span> 学習データはこの端末に保存されます。<button class="inline-link" data-nav="backup">バックアップ</button></p>
  </section>`, 'home');
  bindCommon();
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------
function renderBattle() {
  app.innerHTML = shell(`<section class="battle-screen">
    <div class="battle-topline"><button class="back-button" data-action="leave-battle">‹ <span>中断</span></button><div class="round-label">ROUND <strong>${String(ai.matches + 1).padStart(2, '0')}</strong></div><button class="pause-button" data-action="toggle-pause" aria-label="一時停止">Ⅱ</button><div class="timer" data-time>00:00</div></div>
    <div class="battle-status"><div class="combatant"><span class="combatant-dot player-dot"></span><strong>YOU</strong><small data-player-margin>余裕 —</small></div><div class="versus">VS</div><div class="combatant ai-combatant"><span class="combatant-dot ai-dot"></span><strong>KOMA</strong><small data-ai-margin>余裕 —</small></div></div>
    <div class="battle-stage">
      <div class="stick-zone" data-stick="left" aria-label="左車輪スティック"><span class="stick-label">L 左車輪</span><div class="stick-base"><div class="stick-ticks"></div><div class="stick-knob"><span></span></div></div></div>
      <div class="canvas-wrap"><canvas id="arena-canvas" aria-label="ロボット相撲の土俵"></canvas><div class="arena-hint">相手を土俵の外へ押し出す</div></div>
      <div class="stick-zone" data-stick="right" aria-label="右車輪スティック"><span class="stick-label">R 右車輪</span><div class="stick-base"><div class="stick-ticks"></div><div class="stick-knob"><span></span></div></div></div>
    </div>
    <div class="tactic-readout ${settings.showAIInfo ? '' : 'hidden'}"><span class="readout-pulse"></span><span>AI</span><strong data-tactic-readout>—</strong><small data-situation>—</small></div>
  </section>`, 'battle');
  bindCommon();
  const canvas = document.querySelector('#arena-canvas');
  battle = new BattleSimulation(canvas, ai, { onUpdate: updateBattleHUD, onFinish: handleFinish, sprites: { player: playerSprite, ai: aiSprite }, setup: settings.startSetup, torqueSpeed: settings.torqueSpeed });
  requestAnimationFrame(() => battle?.resize());
  bindStick(document.querySelector('[data-stick="left"]'), 'left');
  bindStick(document.querySelector('[data-stick="right"]'), 'right');
  canvas.addEventListener('pointerdown', () => { if (battle?.paused) { battle.resume(); syncPauseButton(); } });
  battle.start();
}

let lastCountdownWhole = null;
function updateBattleHUD(snapshot) {
  const time = document.querySelector('[data-time]');
  if (!time) return;
  const seconds = Math.floor(snapshot.time);
  time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const readout = document.querySelector('[data-tactic-readout]');
  if (readout) readout.textContent = snapshot.tacticName;
  const situation = document.querySelector('[data-situation]');
  if (situation) situation.textContent = `${snapshot.situation} · 距離 ${snapshot.distance}`;
  const pm = document.querySelector('[data-player-margin]'); const am = document.querySelector('[data-ai-margin]');
  if (pm) { pm.textContent = `土俵際まで ${Math.max(0, snapshot.playerMargin)}`; pm.classList.toggle('danger', snapshot.playerMargin < 25); }
  if (am) { am.textContent = `土俵際まで ${Math.max(0, snapshot.aiMargin)}`; am.classList.toggle('danger', snapshot.aiMargin < 25); }
  const whole = snapshot.countdown > 0 ? Math.ceil(snapshot.countdown) : 0;
  if (whole !== lastCountdownWhole) { if (whole === 0 && lastCountdownWhole) vibrate(30); lastCountdownWhole = whole; }
}

function syncPauseButton() {
  const button = document.querySelector('[data-action="toggle-pause"]');
  if (button && battle) { button.textContent = battle.paused ? '▶' : 'Ⅱ'; button.setAttribute('aria-label', battle.paused ? '再開' : '一時停止'); }
}

const resetStickVisuals = () => document.querySelectorAll('.stick-zone').forEach((zone) => { zone.classList.remove('engaged'); const knob = zone.querySelector('.stick-knob'); if (knob) knob.style.transform = 'translate(-50%, 0)'; });

function bindStick(zone, side) {
  const knob = zone.querySelector('.stick-knob');
  const base = zone.querySelector('.stick-base');
  let activePointer = null; let originY = 0;
  const travel = () => base.getBoundingClientRect().height * 0.36;
  const update = (event) => {
    const raw = Math.max(-1, Math.min(1, -(event.clientY - originY) / travel()));
    const value = shapeStick(raw, settings);
    knob.style.transform = `translate(-50%, ${-raw * travel()}px)`;
    battle?.setInput(side, value);
    zone.classList.toggle('engaged', value !== 0);
  };
  const reset = (event) => {
    if (event && activePointer !== null && event.pointerId !== activePointer) return;
    activePointer = null;
    knob.style.transform = 'translate(-50%, 0)';
    zone.classList.remove('engaged');
    battle?.setInput(side, 0);
  };
  zone.addEventListener('pointerdown', (event) => {
    if (activePointer !== null) return;
    event.preventDefault();
    activePointer = event.pointerId;
    // The stick centre is the base centre, so a touch anywhere in the zone maps consistently.
    const rect = base.getBoundingClientRect(); originY = rect.top + rect.height / 2;
    try { zone.setPointerCapture(event.pointerId); } catch { /* capture can fail for synthetic events */ }
    update(event);
  });
  zone.addEventListener('pointermove', (event) => { if (event.pointerId === activePointer) update(event); });
  zone.addEventListener('pointerup', reset);
  zone.addEventListener('pointercancel', reset);
  zone.addEventListener('lostpointercapture', reset);
  zone.addEventListener('contextmenu', (event) => event.preventDefault());
}

function handleFinish(outcome) {
  vibrate([40, 60, 40]);
  const learning = applyMatchLearning(ai, outcome);
  const saved = persistAI();
  result = {
    winner: outcome.winner, reason: outcome.reason, kind: outcome.kind, time: outcome.time, aiOut: outcome.aiOut, playerOut: outcome.playerOut,
    tacticName: outcome.tacticName, opening: { placement: outcome.opening?.placement }, opponentStyle: outcome.opponentStyle, openingMove: outcome.openingMove,
    failureCause: outcome.failureCause, events: outcome.events,
    used: outcome.tacticUsage.filter((u) => u.executed).map((u) => ({ id: u.tacticId, objective: u.objective, seconds: Number(u.selectedSeconds.toFixed(1)) })),
    changes: learning.changes.map((c) => c.changed), objectives: learning.objectives, checkpoint: learning.checkpoint ? learning.checkpoint.matches : null,
    saved, at: new Date().toISOString()
  };
  storeResult(result);
  setTimeout(() => { if (currentScreen === 'battle') navigate('result', { replace: true, skipGuard: true }); }, 700);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
function resultTexts(r) {
  if (r.kind === 'double-out') return { title: '同時に場外', kicker: 'DOUBLE RING OUT', tone: 'draw', symbol: '＝', detail: '二体がほぼ同時に土俵を割りました。引き分けです。' };
  if (r.kind === 'judge-draw') return { title: '引き分け', kicker: 'TIME UP / DRAW', tone: 'draw', symbol: '＝', detail: '時間切れ。土俵中心からの距離がほぼ同じでした。' };
  if (r.winner === 'player') return r.aiOut
    ? { title: '押し出し勝ち', kicker: 'YOU TAKE THE RING', tone: 'win', symbol: 'W', detail: 'KOMAを土俵の外へ押し出しました。' }
    : { title: '判定勝ち', kicker: 'TIME UP / YOU WIN', tone: 'win', symbol: 'W', detail: '時間切れ。あなたの方が土俵の中心に近い位置でした。' };
  return r.playerOut
    ? { title: '押し出し負け', kicker: 'KOMA TAKES THE RING', tone: 'loss', symbol: 'L', detail: 'KOMAに土俵の外へ押し出されました。' }
    : { title: '判定負け', kicker: 'TIME UP / KOMA WINS', tone: 'loss', symbol: 'L', detail: '時間切れ。KOMAの方が土俵の中心に近い位置でした。' };
}

function renderResult() {
  if (!result) result = restoreResult();
  if (!result) { navigate('home', { replace: true }); return; }
  const t = resultTexts(result);
  const openingLabel = PLACEMENT_LABELS[result.opening?.placement] || result.opening?.placement || '—';
  const used = (result.used || []).map((u) => {
    const def = tacticById(u.id); const mark = u.objective === true ? '<b class="ok">達成</b>' : u.objective === false ? '<b class="ng">未達</b>' : '<b class="na">—</b>';
    return `<li><span style="--tactic-color:${def.color}">${def.icon}</span><div><strong>${escapeHTML(def.name)}</strong><small>${u.seconds}秒</small></div>${mark}</li>`;
  }).join('') || '<li class="empty-change">評価条件を満たす戦術実行はありませんでした（勝敗のみ記録）。</li>';
  const changes = (result.changes || []).slice(0, 4).map((text) => `<li>${escapeHTML(text)}</li>`).join('');
  app.innerHTML = shell(`<section class="result-screen">
    <div class="result-kicker ${t.tone}">${t.kicker}</div>
    <div class="result-burst ${t.tone}"><span class="burst-line line-one"></span><span class="burst-line line-two"></span><div class="result-symbol">${t.symbol}</div></div>
    <h1>${t.title}</h1><p class="result-detail">${t.detail}</p>
    <div class="result-stats"><div><span>対戦時間</span><strong>${Math.floor(result.time)}<small> sec</small></strong></div><div><span>最後のAI戦術</span><strong class="tactic-result">${escapeHTML(result.tacticName)}</strong></div><div><span>初動配置</span><strong>${escapeHTML(openingLabel)}</strong></div></div>
    <div class="result-card"><div class="card-heading"><span>AIが使った戦術と中間目標</span></div><ul class="used-list">${used}</ul>
      <p class="fine">中間目標（側面を取る・横押しから回復する等）は勝敗とは別に記録し、小さく学習に反映します。</p></div>
    <div class="learning-callout"><span class="callout-icon">⌁</span><div><strong>AIの学習メモ</strong>
      <p>あなたの動きは「${escapeHTML(STYLE_LABELS[result.opponentStyle] || result.opponentStyle || '不明')}」型${result.openingMove ? `、立ち合いは「${escapeHTML(OPENING_LABELS[result.openingMove] || result.openingMove)}」` : ''}として記録しました。${result.winner === 'player' ? `敗因の分類: ${escapeHTML(CAUSE_LABELS[result.failureCause] || result.failureCause)}。` : ''}</p>
      ${changes ? `<ul class="change-notes">${changes}</ul>` : ''}
      ${result.checkpoint ? `<p>${result.checkpoint}戦目のチェックポイントを作成しました（バックアップ画面で比較・巻き戻しできます）。</p>` : ''}
      ${result.saved === false ? '<p class="danger-text">⚠ 学習データの保存に失敗しました。設定 → バックアップから書き出しをおすすめします。</p>' : ''}
    </div></div>
    <div class="result-actions"><button class="primary-cta compact" data-action="rematch"><span class="cta-icon">↻</span><span><strong>もう一度対戦</strong><small>同じAIが学習を続けます</small></span><b>→</b></button><button class="secondary-cta" data-nav="growth">AIの成長を見る <span>→</span></button><button class="secondary-cta subtle" data-nav="home">ホームへ</button></div>
  </section>`, 'result');
  bindCommon();
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------
function renderGrowth() {
  const totalSelections = TACTICS.reduce((sum, def) => sum + ai.tactics[def.id].selections, 0);
  const totalExecutions = TACTICS.reduce((sum, def) => sum + ai.tactics[def.id].executions, 0);
  const winRate = matchWinRate(ai);
  const form = recentForm(ai);
  const rows = TACTICS.map((def) => {
    const stat = ai.tactics[def.id]; const rate = successRate(stat); const delta = stat.priority - stat.initialPriority;
    const objective = stat.objective?.attempts ? `${objectiveRate(stat)}%（${stat.objective.successes}/${stat.objective.attempts}）` : '—';
    return `<div class="tactic-row"><div class="tactic-name"><span style="--tactic-color:${def.color}">${def.icon}</span><div><strong>${def.name}</strong><small>${def.pattern}</small></div></div><div class="tactic-number"><strong>${stat.selections}</strong><small>選択 / 実行 ${stat.executions}</small></div><div class="tactic-rate"><strong>${pct(rate)}</strong><div class="rate-bar"><i style="width:${Math.max(4, rate)}%;background:${def.color}"></i></div><small>${stat.wins}勝 ${stat.losses}敗 ${stat.draws}分 · 目標 ${objective}</small></div><div class="tactic-priority"><strong>${stat.priority.toFixed(2)}</strong><small>初期比 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</small></div></div>`;
  }).join('');
  const b = ai.resultBreakdown || {};
  const sit = ai.situationStats || {};
  const escapeAttempts = ai.escapeStats?.attempts || 0;
  const escapeRate = escapeAttempts ? Math.round(((ai.escapeStats?.recoveries || 0) / escapeAttempts) * 100) : null;
  const pivotRate = sit.pivotAttempts ? Math.round((sit.pivotRecoveries / sit.pivotAttempts) * 100) : null;
  const model = ai.opponentModel || { styles: {}, openings: {}, frontal: { contests: 0, losses: 0 } };
  const topEntries = (map, labels) => Object.entries(map || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${escapeHTML(labels[k] || k)} ${v}`).join(' / ') || 'まだ記録なし';
  const frontal = model.frontal || { contests: 0, losses: 0 };
  const placementOrder = ['edge', 'corner', 'close', 'mid', 'open'];
  const placementSummary = placementOrder.map((key) => { const item = ai.placementStats[key] || { uses: 0, wins: 0 }; const rate = item.uses ? Math.round((item.wins / item.uses) * 100) : 0; return `<div class="placement-chip"><span>${escapeHTML(PLACEMENT_LABELS[key] || key)}</span><strong>${item.uses}</strong><small>${rate}% win</small></div>`; }).join('');
  const recent = ai.recentChanges.length ? ai.recentChanges.slice(0, 5).map((item) => `<li><span class="change-dot ${item.result}"></span><div><strong>${escapeHTML(item.text)}</strong><small>${escapeHTML(PLACEMENT_LABELS[item.placement] || item.placement || '配置')} / 相手:${escapeHTML(STYLE_LABELS[item.opponentTactic] || item.opponentTactic || '不明')} / ${fmtDate(item.at)}</small></div></li>`).join('') : '<li class="empty-change">対戦すると、ここに調整履歴が表示されます。</li>';
  app.innerHTML = shell(`<section class="growth-screen">
    <div class="page-heading"><div><span class="eyebrow">AI DEVELOPMENT / LOCAL LOG</span><h1>成長状況</h1><p>KOMAは1体だけを育てます。勝敗・決まり手・中間目標・あなたの傾向を分けて記録し、少しずつ判断を変えます。</p></div><div class="level-orb"><span>${getAILevel(ai).slice(0, 2)}</span><small>STATUS</small></div></div>
    <div class="growth-overview"><div><span>対戦</span><strong>${ai.matches}</strong><small>matches</small></div><div><span>AI勝利</span><strong>${ai.wins}</strong><small>${ai.losses}敗 ${ai.draws}分</small></div><div><span>勝率</span><strong>${winRate}<i>%</i></strong><small>通算</small></div><div><span>戦術実行</span><strong>${totalExecutions}</strong><small>${totalSelections} 選択</small></div></div>
    <div class="section-title"><span>RECENT FORM / 学習前後の比較</span><small>直近10戦と、その前の10戦</small></div>
    <div class="compare-card"><div><span>前の10戦</span><strong>${pct(form.previous)}</strong><small>${form.previousCount}戦</small></div><div class="arrow">→</div><div><span>直近10戦</span><strong>${pct(form.recent)}</strong><small>${form.recentCount}戦</small></div><p>${form.previousCount < 10 ? '比較には20戦以上の記録が必要です。' : Math.abs((form.recent ?? 0) - (form.previous ?? 0)) <= 20 ? '差は偶然の範囲と考えられます（10戦では±20%程度ぶれます）。' : '大きな差があります。悪化が続く場合はバックアップ画面のチェックポイントから戻せます。'}</p></div>
    <div class="section-title"><span>RESULT BREAKDOWN</span><small>決まり手の内訳（AI視点）</small></div>
    <div class="placement-grid six"><div class="placement-chip"><span>押し出し勝</span><strong>${b.pushOutWins || 0}</strong></div><div class="placement-chip"><span>判定勝</span><strong>${b.judgeWins || 0}</strong></div><div class="placement-chip"><span>場外負</span><strong>${b.ringOutLosses || 0}</strong></div><div class="placement-chip"><span>判定負</span><strong>${b.judgeLosses || 0}</strong></div><div class="placement-chip"><span>判定分</span><strong>${b.judgeDraws || 0}</strong></div><div class="placement-chip"><span>同時場外</span><strong>${b.doubleOuts || 0}</strong></div></div>
    <div class="section-title"><span>TACTIC MATRIX</span><small>勝敗の評価率 / 中間目標 / 優先度</small></div>
    <div class="tactic-table">${rows}</div>
    <div class="growth-columns">
      <div class="insight-card"><div class="card-heading"><span>SITUATION RESPONSE</span><span class="live-pill tiny"><i></i> 勝敗とは別</span></div>
        <ul class="kv-list"><li><span>相手の側面を押せた時間</span><b>${(sit.sideHitSeconds || 0).toFixed(1)} 秒</b></li><li><span>横から押された時間</span><b>${(sit.sidePressureSeconds || 0).toFixed(1)} 秒（${sit.sideEpisodes || 0}回）</b></li><li><span>横押しからの向き直り成功</span><b>${pct(pivotRate)}（${sit.pivotRecoveries || 0}/${sit.pivotAttempts || 0}）</b></li><li><span>土俵際からの脱出成功</span><b>${pct(escapeRate)}（${ai.escapeStats?.recoveries || 0}/${escapeAttempts}）</b></li><li><span>正面で押し負けた時間</span><b>${(sit.frontalLossSeconds || 0).toFixed(1)} 秒</b></li></ul></div>
      <div class="insight-card"><div class="card-heading"><span>YOUR TENDENCY</span><span class="live-pill tiny"><i></i> 相手モデル</span></div>
        <ul class="kv-list"><li><span>あなたの動き方</span><b>${topEntries(model.styles, STYLE_LABELS)}</b></li><li><span>立ち合いの初動</span><b>${topEntries(model.openings, OPENING_LABELS)}</b></li><li><span>正面の押し合い</span><b>${frontal.contests ? `${frontal.contests}回中 AIが押し負け ${frontal.losses}回` : 'まだ記録なし'}</b></li></ul>
        <p class="learning-copy">立ち合いの初動は次の試合の読みに、正面での強さは「正面勝負を避けるか」の判断に使います。</p></div>
    </div>
    <div class="opening-insight"><div class="card-heading"><span>OPENING READ / PLACEMENT</span><span class="live-pill tiny"><i></i> RULE + LEARNED</span></div><div class="placement-grid">${placementSummary}</div></div>
    <div class="growth-columns">
      <div class="insight-card"><div class="card-heading"><span>RECENT ADJUSTMENTS</span><span class="live-pill tiny"><i></i> LOCAL</span></div><ul class="change-list">${recent}</ul></div>
      <div class="insight-card"><div class="card-heading"><span>LEARNING RULE</span></div><p class="learning-copy">実行した各戦術へ、稼働時間と接触時間から求めた貢献度に応じて勝敗を配分します（1つの戦術に丸ごと帰属させない）。中間目標の達成は勝敗の約1/4の大きさで別に反映します。学習した優先度が判断に与える影響は初期値の周辺に制限し、横押し回避・いなし・脱出のような反射的な戦術はほとんど動かしません。10戦ごとにチェックポイントを残します。</p></div>
    </div>
    <div class="reset-area"><button class="text-button" data-nav="backup">バックアップ・復元・初期化 →</button></div>
  </section>`, 'growth');
  bindCommon();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  app.innerHTML = shell(`<section class="settings-screen">
    <div class="page-heading"><div><span class="eyebrow">SETTINGS</span><h1>設定</h1><p>操作と表示の設定はこの端末だけに保存され、AIの学習データには影響しません。</p></div></div>
    <div class="settings-group"><h2>操作</h2>
      <label class="setting-row"><span><strong>スティック感度</strong><small>大きいほど少ない移動で最大速度</small></span><input type="range" min="0.7" max="1.4" step="0.05" value="${settings.stickSensitivity}" data-setting="stickSensitivity"><output data-out="stickSensitivity">${settings.stickSensitivity.toFixed(2)}</output></label>
      <label class="setting-row"><span><strong>デッドゾーン</strong><small>中央付近の小さな動きを無視</small></span><input type="range" min="0" max="0.2" step="0.01" value="${settings.deadzone}" data-setting="deadzone"><output data-out="deadzone">${Math.round(settings.deadzone * 100)}%</output></label>
      <label class="setting-row toggle"><span><strong>振動</strong><small>開始・終了時に短く振動（対応端末のみ）</small></span><input type="checkbox" ${settings.vibration ? 'checked' : ''} data-setting="vibration"></label>
<label class=\"setting-row\"><span><strong>トルク \\u2192 スピード</strong><small>0：トルク重視・低速型、100：スピード重視・高回転型</small></span><br><input type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"${settings.torqueSpeed}\" data-setting=\"torqueSpeed\"><output data-out=\"torqueSpeed\">${settings.torqueSpeed}</output><span style=\"float: left; width: 45%;\">トルク重視</span><span style=\"float: right; width: 45%;\">スピード重視</span></label>
    </div>
    <div class="settings-group"><h2>対戦</h2>
      <label class="setting-row toggle"><span><strong>AIの戦術・状況を表示</strong><small>対戦中にKOMAの判断を表示</small></span><input type="checkbox" ${settings.showAIInfo ? 'checked' : ''} data-setting="showAIInfo"></label>
      <label class="setting-row"><span><strong>初期配置</strong><small>ランダムは左右対称に配置します</small></span><select data-setting="startSetup"><option value="standard" ${settings.startSetup === 'standard' ? 'selected' : ''}>正対（標準）</option><option value="random" ${settings.startSetup === 'random' ? 'selected' : ''}>ランダム</option></select></label>
    </div>
    <div class="settings-group"><h2>データ</h2>
      <button class="setting-link" data-nav="backup"><span><strong>学習データのバックアップ・復元</strong><small>書き出し / 読み込み / 自動バックアップ / 初期化</small></span><b>›</b></button>
    </div>
    <div class="settings-group"><h2>アプリ</h2>
      <ul class="kv-list" data-app-info><li><span>バージョン</span><b>${escapeHTML(APP_VERSION)}</b></li><li><span>オフライン対応</span><b data-sw>確認中…</b></li><li><span>保存領域の保護</span><b data-persist>確認中…</b></li><li><span>使用容量</span><b data-usage>—</b></li></ul>
      <button class="secondary-cta" data-action="check-update">アップデートを確認</button>
    </div>
  </section>`, 'settings');
  bindCommon();
  document.querySelectorAll('[data-setting]').forEach((input) => input.addEventListener('input', () => {
    const key = input.dataset.setting;
    const value = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
    settings = { ...settings, [key]: value };
    if (!saveSettings(settings)) showToast('設定を保存できませんでした。', { tone: 'danger' });
    const out = document.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = key === 'deadzone' ? `${Math.round(value * 100)}%` : Number(value).toFixed(2);
  }));
  document.querySelector('[data-action="check-update"]')?.addEventListener('click', async () => { const r = await checkForUpdate(); showToast(r.message, { tone: r.ok ? 'info' : 'danger' }); });
  const sw = document.querySelector('[data-sw]');
  if (sw) sw.textContent = !pwaState.supported ? '非対応のブラウザ' : pwaState.error ? pwaState.error : pwaState.registered ? (navigator.serviceWorker.controller ? '有効（オフラインで起動可）' : '準備完了（次回起動から有効）') : '登録中…';
  storageStatus().then((status) => {
    const persist = document.querySelector('[data-persist]'); const usage = document.querySelector('[data-usage]');
    if (persist) persist.textContent = status.persisted === null ? '不明' : status.persisted ? '有効（自動削除されにくい）' : '未許可（ホーム画面に追加すると有効になりやすい）';
    if (usage) usage.textContent = status.usage == null ? '—' : `${bytes(status.usage)} / ${bytes(status.quota)}`;
  });
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
function summaryHTML(summary) {
  return `<ul class="kv-list compact"><li><span>対戦回数</span><b>${summary.matches}</b></li><li><span>AI戦績</span><b>${summary.wins}勝 ${summary.losses}敗 ${summary.draws}分</b></li><li><span>最終更新</span><b>${escapeHTML(fmtDate(summary.lastUpdated))}</b></li></ul>`;
}

function renderBackup() {
  const summary = summarizeAI(ai);
  let size = null; try { size = (localStorage.getItem('sumo500-ai-v2') || '').length; } catch { size = null; }
  const save = getSaveReport();
  const backups = listBackups();
  const backupRows = backups.length ? backups.map((item) => `<li><div><strong>${escapeHTML(backupLabel(item.reason))}</strong><small>${escapeHTML(fmtDate(item.at))}${item.summary ? ` · ${item.summary.matches}戦 ${item.summary.wins}勝${item.summary.losses}敗` : ' · 読み込めない形式'}</small></div>${item.summary ? `<button class="small-button" data-restore="${escapeHTML(item.key)}">復元</button>` : ''}</li>`).join('') : '<li class="empty-change">まだ自動バックアップはありません。インポート・初期化・巻き戻しの前に自動で作られます。</li>';
  const checkpoints = (ai.checkpoints || []).slice().reverse();
  const checkpointRows = checkpoints.length ? checkpoints.map((cp) => `<li><div><strong>${cp.matches}戦目</strong><small>${escapeHTML(fmtDate(cp.at))} · 直前${cp.window.matches}戦 ${cp.window.wins}勝${cp.window.losses}敗${cp.window.draws}分</small></div><button class="small-button" data-rollback="${cp.matches}">この調整値に戻す</button></li>`).join('') : '<li class="empty-change">10戦ごとに作成されます。</li>';
  app.innerHTML = shell(`<section class="backup-screen">
    <div class="page-heading"><div><span class="eyebrow">BACKUP / RESTORE</span><h1>バックアップ</h1><p>学習データはこの端末のブラウザ内（localStorage）にあります。機種変更やブラウザのデータ削除に備えて、ファイルに書き出しておけます。</p></div></div>
    <div class="settings-group"><h2>現在のデータ</h2>${summaryHTML(summary)}
      <ul class="kv-list compact"><li><span>データ形式</span><b>v${summary.dataVersion}</b></li><li><span>サイズ</span><b>${bytes(size)}</b></li><li><span>最後の保存</span><b class="${save.ok === false ? 'danger-text' : ''}">${save.at ? (save.ok ? `成功（${escapeHTML(fmtDate(save.at))}）` : `失敗: ${escapeHTML(save.error)}`) : 'この起動ではまだ保存なし'}</b></li></ul></div>
    <div class="settings-group"><h2>書き出し（エクスポート）</h2><p class="fine">JSONファイルとして保存します。Googleドライブなどに保管しておくと安心です。</p>
      <div class="button-row"><button class="primary-cta compact" data-action="export"><span class="cta-icon">⇩</span><span><strong>ファイルに書き出す</strong><small>sumo500-ai-日付.json</small></span></button>${navigator.canShare ? '<button class="secondary-cta" data-action="share">共有…</button>' : ''}</div></div>
    <div class="settings-group"><h2>読み込み（インポート）</h2><p class="fine">書き出したファイルを読み込みます。上書きする前に内容を確認し、今のデータは自動でバックアップされます。</p>
      <label class="file-button"><input type="file" accept="application/json,.json" data-action="import-file"><span>ファイルを選ぶ</span></label></div>
    <div class="settings-group"><h2>自動バックアップ</h2><ul class="backup-list">${backupRows}</ul></div>
    <div class="settings-group"><h2>チェックポイント（学習の巻き戻し）</h2><p class="fine">学習で弱くなったと感じたら、戦績は残したまま戦術の調整値だけを過去の状態に戻せます。</p><ul class="backup-list">${checkpointRows}</ul></div>
    <div class="settings-group danger-zone"><h2>初期化</h2><p class="fine">対戦記録と学習をすべて初期状態に戻します。実行前の状態は自動バックアップに残ります。</p><button class="text-button danger" data-action="reset-ai">学習データを初期化する</button></div>
  </section>`, 'backup');
  bindCommon();
  const filename = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `sumo500-ai-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`; };
  document.querySelector('[data-action="export"]')?.addEventListener('click', () => {
    const blob = new Blob([exportAI(ai)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('学習データを書き出しました。');
  });
  document.querySelector('[data-action="share"]')?.addEventListener('click', async () => {
    const file = new File([exportAI(ai)], filename(), { type: 'application/json' });
    if (!navigator.canShare?.({ files: [file] })) { showToast('この端末ではファイル共有に対応していません。「ファイルに書き出す」を使ってください。', { tone: 'danger' }); return; }
    try { await navigator.share({ files: [file], title: 'SUMO 500 学習データ' }); }
    catch (error) { if (error?.name !== 'AbortError') showToast(`共有できませんでした: ${error?.message || error}`, { tone: 'danger' }); }
  });
  document.querySelector('[data-action="import-file"]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('ファイルが大きすぎます（5MBまで）。', { tone: 'danger' }); return; }
    const parsed = parseImport(await file.text());
    if (!parsed.ok) { showToast(parsed.error, { tone: 'danger', duration: 6000 }); return; }
    const ok = await showModal({ title: 'このデータで上書きしますか？', confirmLabel: '上書きして読み込む', danger: true,
      body: `<p><strong>読み込むデータ</strong>${parsed.exportedAt ? `（${escapeHTML(fmtDate(parsed.exportedAt))} に書き出し）` : ''}</p>${summaryHTML(parsed.summary)}<p><strong>今のデータ</strong>（自動バックアップに保存されます）</p>${summaryHTML(summarizeAI(ai))}` });
    if (!ok) return;
    const imported = importAI(parsed.ai);
    if (!imported.ok) { showToast('保存に失敗しました。今のデータは変更されていません。', { tone: 'danger' }); return; }
    ai = loadAI(); showToast('学習データを読み込みました。'); renderBackup();
  });
  document.querySelectorAll('[data-restore]').forEach((button) => button.addEventListener('click', async () => {
    const item = backups.find((b) => b.key === button.dataset.restore);
    const ok = await showModal({ title: 'このバックアップを復元しますか？', confirmLabel: '復元する', danger: true, body: `<p>${escapeHTML(backupLabel(item.reason))}（${escapeHTML(fmtDate(item.at))}）</p>${summaryHTML(item.summary)}<p>今のデータは自動バックアップに保存されます。</p>` });
    if (!ok) return;
    const restored = restoreBackup(item.key);
    if (!restored.ok) { showToast(restored.error || '復元できませんでした。', { tone: 'danger' }); return; }
    ai = loadAI(); showToast('バックアップを復元しました。'); renderBackup();
  }));
  document.querySelectorAll('[data-rollback]').forEach((button) => button.addEventListener('click', async () => {
    const matches = Number(button.dataset.rollback);
    const ok = await showModal({ title: `${matches}戦目の調整値に戻しますか？`, confirmLabel: '戻す', body: '<p>戦術の優先度と実行パラメータだけを戻します。対戦記録・相手モデルはそのまま残ります。実行前の状態は自動バックアップに保存されます。</p>' });
    if (!ok) return;
    const rolled = rollbackToCheckpoint(ai, matches);
    showToast(rolled.ok ? '調整値を戻しました。' : (rolled.error || '保存に失敗しました。'), { tone: rolled.ok ? 'info' : 'danger' });
    renderBackup();
  }));
  document.querySelector('[data-action="reset-ai"]')?.addEventListener('click', async () => {
    const ok = await showModal({ title: '学習データを初期化しますか？', confirmLabel: '初期化する', danger: true, body: `${summaryHTML(summarizeAI(ai))}<p>初期化前のデータは自動バックアップに残りますが、念のため先に「ファイルに書き出す」ことをおすすめします。</p>` });
    if (!ok) return;
    ai = resetAI(); showToast('学習データを初期化しました。'); renderBackup();
  });
}

// ---------------------------------------------------------------------------
// Common bindings
// ---------------------------------------------------------------------------
function bindCommon() {
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
  document.querySelectorAll('[data-action="start-battle"]').forEach((button) => button.addEventListener('click', () => { if (currentScreen !== 'battle') { result = null; navigate('battle'); } }));
  document.querySelectorAll('[data-action="rematch"]').forEach((button) => button.addEventListener('click', () => { result = null; navigate('battle', { replace: true }); }));
  document.querySelectorAll('[data-action="leave-battle"]').forEach((button) => button.addEventListener('click', () => navigate('home')));
  document.querySelectorAll('[data-action="toggle-pause"]').forEach((button) => button.addEventListener('click', () => { if (!battle || battle.ended) return; if (battle.paused) battle.resume(); else battle.pause(); resetStickVisuals(); syncPauseButton(); }));
}

window.addEventListener('resize', () => battle?.resize());
window.addEventListener('orientationchange', () => setTimeout(() => battle?.resize(), 250));
// Losing focus or hiding the page must never leave a wheel running.
window.addEventListener('blur', () => { battle?.releaseInputs(); resetStickVisuals(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (battleInProgress()) { battle.pause(); resetStickVisuals(); syncPauseButton(); }
    if (battle && !battle.ended) persistAI();
  }
});
window.addEventListener('pagehide', () => { if (battle && !battle.ended) persistAI(); });
window.addEventListener('online', () => { if (currentScreen !== 'battle') render(); });
window.addEventListener('offline', () => { if (currentScreen !== 'battle') render(); });

registerServiceWorker({
  onUpdated: () => {
    if (battleInProgress()) { pendingUpdate = true; return; }
    showToast('新しいバージョンを読み込みました。', { duration: 0, action: { label: '再読み込み', run: () => window.location.reload() } });
  }
});
setInterval(() => { if (pendingUpdate && !battleInProgress()) { pendingUpdate = false; showToast('新しいバージョンがあります。', { duration: 0, action: { label: '再読み込み', run: () => window.location.reload() } }); } }, 2000);
requestPersistentStorage();

// Read-only inspection hook for automated browser checks (only with ?debug in the URL).
if (new URLSearchParams(window.location.search).has('debug')) window.__sumo = { get battle() { return battle; }, get ai() { return ai; }, get screen() { return currentScreen; } };

currentScreen = screenFromPath();
window.history.replaceState({ screen: currentScreen }, '', window.location.pathname + window.location.search);
render();
if (startupReport.status === 'corrupt') showToast('保存データが壊れていたため、元のデータを退避して新しく開始しました。バックアップ画面から確認できます。', { tone: 'danger', duration: 9000 });
else if (startupReport.status === 'migrated') {
  // Store the migrated data right away (the original is already kept as a backup),
  // so the migration runs — and is announced — only once.
  if (persistAI()) showToast('学習データを新しい形式に移行しました（移行前のデータはバックアップに保存）。', { duration: 5000 });
}
else if (startupReport.status === 'newer-version') showToast('新しいバージョンのアプリで保存されたデータです。読める部分だけを使用し、元データはバックアップに保存しました。', { tone: 'danger', duration: 9000 });
else if (startupReport.status === 'storage-unavailable') showToast('この環境ではデータを保存できません（プライベートモード等）。学習結果は残りません。', { tone: 'danger', duration: 9000 });
