// Per-device play settings. Kept separate from the AI learning data so a settings
// change can never touch the learning record.
const SETTINGS_KEY = 'sumo500-settings';

// Torque-speed balance settings per machine (0=torque focus, 100=speed focus)
const TORQUE_SPEED_PRESET_MAX_SPEED = [136, 149.6, 170, 190.4, 204];
const TORQUE_SPEED_PRESET_DRIVE_ACCEL = [537.5, 488.6, 430, 383.9, 358.3];

export const DEFAULT_SETTINGS = Object.freeze({
  stickSensitivity: 1,     // 0.7 – 1.4: how far the knob must travel for full wheel speed
  deadzone: 0.08,          // 0 – 0.2: ignored stick travel around the centre
  vibration: true,
  showAIInfo: true,
  startSetup: 'standard',   // 'standard' (facing) | 'random' (mirrored random placement)
  torqueSpeed: 50          // 0=torque focus, 100=speed focus
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));


export function sanitizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  // Per-aircraft torqueSpeed: keyed by startSetup to allow different
  // torqueSpeed values for different battle configurations (e.g. player vs AI configs).
  const torqueSpeedBySetup = {};
  // Collect existing torqueSpeedBySetup values, preserving 0 as valid value
  if (source.torqueSpeedBySetup && typeof source.torqueSpeedBySetup === 'object') {
    for (const [setup, value] of Object.entries(source.torqueSpeedBySetup)) {
      torqueSpeedBySetup[setup] = clamp(number(value, DEFAULT_SETTINGS.torqueSpeed), 0, 100);
    }
  }
  // Ensure the current startSetup has a torqueSpeed value
  // Key-existence check (not truthy) so 0 is preserved as valid setting
  const currentSetup = source.startSetup === 'random' ? 'random' : 'standard';
  if (!(currentSetup in torqueSpeedBySetup)) {
    // Migration: if old format has torqueSpeed, use it; otherwise use default 50
    if (source.torqueSpeed !== undefined && Number.isFinite(source.torqueSpeed)) {
      torqueSpeedBySetup[currentSetup] = clamp(number(source.torqueSpeed, DEFAULT_SETTINGS.torqueSpeed), 0, 100);
    } else {
      torqueSpeedBySetup[currentSetup] = DEFAULT_SETTINGS.torqueSpeed;
    }
  }
  return {
    stickSensitivity: clamp(number(source.stickSensitivity, DEFAULT_SETTINGS.stickSensitivity), 0.7, 1.4),
    deadzone: clamp(number(source.deadzone, DEFAULT_SETTINGS.deadzone), 0, 0.2),
    vibration: typeof source.vibration === 'boolean' ? source.vibration : DEFAULT_SETTINGS.vibration,
    showAIInfo: typeof source.showAIInfo === 'boolean' ? source.showAIInfo : DEFAULT_SETTINGS.showAIInfo,
    startSetup: source.startSetup === 'random' ? 'random' : 'standard',
    torqueSpeed: clamp(number(source.torqueSpeed, DEFAULT_SETTINGS.torqueSpeed), 0, 100),
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
