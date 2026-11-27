// Per-device play settings. Kept separate from the AI learning data so a settings
// change can never touch the learning record.
const SETTINGS_KEY = 'sumo500-settings';

// Torque-speed balance settings per machine (0=torque focus, 100=speed focus)
const TORQUE_SPEED_PRESET_MAX_SPEED = [136, 149.6, 170, 190.4, 204];
const TORQUE_SPEED_PRESET_DRIVE_ACCEL = [537.5, 488.6, 430, 383.9, 358.3];
const TORQUE_SPEED_POINTS_S = [0, 25, 50, 75, 100];
// Torque-speed preset values: easy=30, normal=50, hard=70 (0-100 scale)
export const TORQUE_SPEED_PRESETS = {
  easy: 30,      // AI弱め (プレイヤー有利)
  normal: 50,    // 既定 (AIとプレイヤー同等)
  hard: 70       // AI強め (プレイヤー不利)
};
export const DEFAULT_SETTINGS = Object.freeze({
  stickSensitivity: 1,     // 0.7 – 1.4: how far the knob must travel for full wheel speed
  deadzone: 0.08,          // 0 – 0.2: ignored stick travel around the centre
  vibration: true,
  showAIInfo: true,
  startSetup: 'standard',   // 'standard' (facing) | 'random' (mirrored random placement)
  torqueSpeed: 50,         // 0=torque focus, 100=speed focus
  consecutiveBattle: true, // auto-restart after match end
  // aiOpponentTorquePreset は sanitizeSettings で追加される
  aiOpponentTorquePreset: 'normal',
  // Detailed mode: use RPM and gear ratio instead of torque speed slider
  detailedMode: false,
  // Player vehicle detailed settings
  motorRpm: 10000,         // Motor RPM (revolutions per minute)
  gearRatio: 5.0,          // Gear ratio (e.g., 5.0 = 5:1)
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));


export function sanitizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  
  // === プレイヤー機体の設定 (変更しない) ===
  const torqueSpeed = number(source.torqueSpeed, DEFAULT_SETTINGS.torqueSpeed);
// detailedMode flag
  const detailedMode = source.detailedMode === true;
  // motorRpm と gearRatio から equivalentTorqueSpeed を計算
  let equivalentTorqueSpeed = torqueSpeed; // Default: use normal torqueSpeed
  if (detailedMode) {
    const motorRpm = number(source.motorRpm, DEFAULT_SETTINGS.motorRpm);
    const gearRatio = number(source.gearRatio, DEFAULT_SETTINGS.gearRatio);
    // ギア比が大きいほどトルク重視、小さいほどスピード重視
    // モーター回転数が高いほどスピード重視
    // 5000-15000 rpm の範囲、gearRatio 3-10 の範囲で normal (50) を基準
    const normalizedRpm = clamp(Math.round((motorRpm - 5000) / 100), 0, 100);
    const normalizedGear = clamp(Math.round((10 - gearRatio) * 10), 0, 100);
    // RPM とギア比のウェイト付き平均 (RPM 60%, ギア比 40%)
    equivalentTorqueSpeed = Math.round(0.6 * normalizedRpm + 0.4 * normalizedGear);
    equivalentTorqueSpeed = clamp(equivalentTorqueSpeed, 0, 100);
  }
  // === 相手機体の性能プリセット ===
  
  // === 相手機体の性能プリセット ===
  // 'easy' | 'normal' | 'hard' から設定。不明な値は 'normal' (50) に補正
  let aiOpponentTorquePreset = 'normal';
  if (source.aiOpponentTorquePreset !== undefined && source.aiOpponentTorquePreset !== null) {
    if (TORQUE_SPEED_PRESETS[source.aiOpponentTorquePreset] !== undefined) {
      aiOpponentTorquePreset = source.aiOpponentTorquePreset;
    }
    // 未知の値の場合は 'normal' のままにする（50が適用される）
  }
  
  // プリセットから実際の torqueSpeed を決定
  let aiTorqueSpeed;
  if (TORQUE_SPEED_PRESETS[aiOpponentTorquePreset] !== undefined) {
    aiTorqueSpeed = TORQUE_SPEED_PRESETS[aiOpponentTorquePreset];
  } else if (typeof source.aiTorqueSpeed !== 'undefined' && Number.isFinite(source.aiTorqueSpeed)) {
    // 個別設定の場合は数値を使用
    aiTorqueSpeed = clamp(number(source.aiTorqueSpeed, DEFAULT_SETTINGS.torqueSpeed), 0, 100);
  } else {
    // デフォルトは normal (50)
    aiTorqueSpeed = DEFAULT_SETTINGS.aiTorqueSpeed !== undefined ? DEFAULT_SETTINGS.aiTorqueSpeed : 50;
  }
  
  // torqueSpeedBySetup の保持 (既存の機能)
  const torqueSpeedBySetup = {};
  if (source.torqueSpeedBySetup && typeof source.torqueSpeedBySetup === 'object') {
    for (const [setup, value] of Object.entries(source.torqueSpeedBySetup)) {
      torqueSpeedBySetup[setup] = clamp(number(value, DEFAULT_SETTINGS.torqueSpeed), 0, 100);
    }
  }
  // 現在の startSetup に値がなければ設定
  const currentSetup = source.startSetup === 'random' ? 'random' : 'standard';
  if (!(currentSetup in torqueSpeedBySetup)) {
    torqueSpeedBySetup[currentSetup] = clamp(number(source.torqueSpeed, DEFAULT_SETTINGS.torqueSpeed), 0, 100);
  }
  
  return {
    stickSensitivity: clamp(number(source.stickSensitivity, DEFAULT_SETTINGS.stickSensitivity), 0.7, 1.4),
    deadzone: clamp(number(source.deadzone, DEFAULT_SETTINGS.deadzone), 0, 0.2),
    vibration: typeof source.vibration === 'boolean' ? source.vibration : DEFAULT_SETTINGS.vibration,
    showAIInfo: typeof source.showAIInfo === 'boolean' ? source.showAIInfo : DEFAULT_SETTINGS.showAIInfo,
    consecutiveBattle: typeof source.consecutiveBattle !== 'undefined' ? source.consecutiveBattle : DEFAULT_SETTINGS.concurrentBattle,
    startSetup: source.startSetup === 'random' ? 'random' : 'standard',
    torqueSpeed: clamp(number(source.torqueSpeed, DEFAULT_SETTINGS.torqueSpeed), 0, 100),
    // プレヤーと分離した相手機体のトルク設定
    aiTorqueSpeed: detailedMode ? equivalentTorqueSpeed : aiTorqueSpeed,
    // プリセット名（保存時の識別用）
    aiOpponentTorquePreset: aiOpponentTorquePreset,
    torqueSpeedBySetup: torqueSpeedBySetup
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  try { return sanitizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}')); }
  catch { return sanitizeSettings({}); }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings))); return true; }
  catch { return false; }
}

// Maps a raw stick deflection (-1 … 1) to a wheel command with sensitivity and dead zone.
export function shapeStick(raw, { stickSensitivity, deadzone }) {
  const scaled = clamp(raw * stickSensitivity, -1, 1);
  const magnitude = Math.abs(scaled);
  if (magnitude <= deadzone) return 0;
  return Math.sign(scaled) * clamp((magnitude - deadzone) / (1 - deadzone), 0, 1);
}
