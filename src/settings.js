// Per-device play settings. Kept separate from the AI learning data so a settings
// change can never touch the learning record.
const SETTINGS_KEY = 'sumo500-settings';

export const DEFAULT_SETTINGS = Object.freeze({
  stickSensitivity: 1,     // 0.7 – 1.4: how far the knob must travel for full wheel speed
  deadzone: 0.08,          // 0 – 0.2: ignored stick travel around the centre
  vibration: true,
  showAIInfo: true,
  startSetup: 'standard'   // 'standard' (facing) | 'random' (mirrored random placement)
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function sanitizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    stickSensitivity: clamp(number(source.stickSensitivity, DEFAULT_SETTINGS.stickSensitivity), 0.7, 1.4),
    deadzone: clamp(number(source.deadzone, DEFAULT_SETTINGS.deadzone), 0, 0.2),
    vibration: typeof source.vibration === 'boolean' ? source.vibration : DEFAULT_SETTINGS.vibration,
    showAIInfo: typeof source.showAIInfo === 'boolean' ? source.showAIInfo : DEFAULT_SETTINGS.showAIInfo,
    startSetup: source.startSetup === 'random' ? 'random' : 'standard'
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
