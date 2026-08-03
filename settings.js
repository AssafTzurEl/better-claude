// Better Claude - Shared settings module
// Owns the defaults table, the storage read, and validation. Loaded first in
// the content_scripts list, so rtl.js and usage.js can read `bcSettings` and
// gate their init on `bcSettingsReady`.
// Content scripts share one global scope - every global here is bc*/BC_*.
// https://github.com/AssafTzurEl/better-claude

// === Defaults ===
const BC_SETTINGS_DEFAULTS = Object.freeze({
  ltrRatioThreshold: 1.2,      // LTR wins only if ltrCount > rtlCount * this
  defaultInputDirection: 'ltr',
  debugLogging: false,
  usageBarsEnabled: true,
  schemaVersion: 1,
});

// The threshold is a ratio, so its natural centre is 1.0 (whichever script has
// more letters wins) and its natural symmetry is geometric: the mirror of 0.5
// is 2.0, not 1.5. The options-page slider spans 1:2 .. 2:1; this band is
// deliberately wider, as tolerance for hand-edited or future values - they stay
// in effect, and only the slider thumb snaps to the nearest stop.
const BC_LTR_RATIO_MIN = 0.333; // ~1/3, the mirror of 3.0
const BC_LTR_RATIO_MAX = 3.0;
// Values below 1.0 are reciprocals (1/1.2 = 0.833...), so one decimal is not
// enough resolution to round-trip a slider stop.
const BC_LTR_RATIO_DECIMALS = 3;

// === Logging ===
// Standalone: bcSettings may not be populated yet when this runs.
function bcSettingsLog(...args) {
  if (bcSettings.debugLogging) console.log('[Better Claude / settings]', ...args);
}

// === Validation ===
// Storage can hold values from an older version or a hand-edited profile, so
// every key is coerced and clamped on read - never trusted as stored.

function bcClampNumber(value, min, max, fallback, decimals = 0) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  const factor = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * factor) / factor));
}

function bcValidateBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

// Returns a full settings object: every key present, every value usable.
// Unknown keys in `raw` are ignored; missing or invalid ones fall back.
function bcValidateSettings(raw) {
  const d = BC_SETTINGS_DEFAULTS;
  const src = (raw && typeof raw === 'object') ? raw : {};

  return {
    ltrRatioThreshold: bcClampNumber(
      src.ltrRatioThreshold, BC_LTR_RATIO_MIN, BC_LTR_RATIO_MAX,
      d.ltrRatioThreshold, BC_LTR_RATIO_DECIMALS
    ),
    defaultInputDirection:
      (src.defaultInputDirection === 'ltr' || src.defaultInputDirection === 'rtl')
        ? src.defaultInputDirection
        : d.defaultInputDirection,
    debugLogging: bcValidateBoolean(src.debugLogging, d.debugLogging),
    usageBarsEnabled: bcValidateBoolean(src.usageBarsEnabled, d.usageBarsEnabled),
    // Floored, not rounded: a fractional version must never round up into
    // claiming to be the next one, or a migration keyed on it gets skipped.
    schemaVersion: Math.floor(bcClampNumber(src.schemaVersion, 1, 999, d.schemaVersion, 3)),
  };
}

// === Current values ===
// Mutated in place, never rebound, so consumers holding a reference always
// see current values.
const bcSettings = { ...BC_SETTINGS_DEFAULTS };

function bcApplySettings(raw) {
  Object.assign(bcSettings, bcValidateSettings(raw));
  return bcSettings;
}

// === Storage read ===
// Resolves to `bcSettings` once storage has been read. Never rejects: if
// storage is unavailable or throws, we keep the defaults and carry on.
const bcSettingsReady = (async () => {
  try {
    const stored = await browser.storage.sync.get(Object.keys(BC_SETTINGS_DEFAULTS));
    bcApplySettings(stored);
    bcSettingsLog('loaded', bcSettings);
  } catch (e) {
    console.warn('[Better Claude / settings] storage unavailable, using defaults:', e);
  }
  return bcSettings;
})();

// === Dev exports (Firefox only) ===
// Content-script globals live in an isolated sandbox: the page console cannot
// see them, and until Step 1 adds the options page there is no privileged
// extension context to run browser.storage.sync.set() from either. Flip this to
// true during development to drive settings from the page console (F12).
// It must stay false in shipped code - same rule as usage.js: a debug flag
// should never add API surface to claude.ai. Delete once the options page can
// do this job.
const BC_SETTINGS_DEV_EXPORTS = false;

if (BC_SETTINGS_DEV_EXPORTS && typeof exportFunction === 'function') {
  // Arguments cross the sandbox boundary, so these take/return JSON strings
  // rather than objects - a primitive crosses cleanly, a plain object does not.
  exportFunction(function() {
    console.log('[Better Claude / settings] current:', JSON.stringify(bcSettings));
  }, window, { defineAs: 'bcDumpSettings' });

  exportFunction(function(json) {
    browser.storage.sync.set(JSON.parse(json)).then(
      () => console.log('[Better Claude / settings] wrote', json, '- reload to re-read'),
      e  => console.error('[Better Claude / settings] write failed:', e)
    );
  }, window, { defineAs: 'bcSetSettings' });

  exportFunction(function() {
    browser.storage.sync.clear().then(
      () => console.log('[Better Claude / settings] cleared - reload to re-read'),
      e  => console.error('[Better Claude / settings] clear failed:', e)
    );
  }, window, { defineAs: 'bcClearSettings' });

  console.log('[Better Claude / settings] dev exports active:',
    'bcDumpSettings(), bcSetSettings(json), bcClearSettings()');
}
