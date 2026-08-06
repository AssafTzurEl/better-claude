// Better Claude - Shared settings module
// Owns the defaults table, the storage read, and validation. Loaded first in
// the content_scripts list, so rtl.js and usage.js can read `bcSettings` and
// gate their init on `bcSettingsReady` - and loaded again by options.html, so
// the settings page validates against the same table rather than its own copy.
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

// Validates `raw`, applies it, and reports which keys actually changed value.
// The diff is what makes the change plumbing quiet: a write that lands on the
// values we already hold notifies nobody.
function bcApplyAndDiff(raw) {
  const next = bcValidateSettings(raw);
  const changed = new Set();
  for (const key of Object.keys(BC_SETTINGS_DEFAULTS)) {
    if (bcSettings[key] !== next[key]) changed.add(key);
  }
  Object.assign(bcSettings, next);
  return changed;
}

function bcApplySettings(raw) {
  bcApplyAndDiff(raw);
  return bcSettings;
}

// === Change notification ===
// Each consumer registers its own reaction, so settings.js never has to reach
// into rtl.js or usage.js internals. Listeners receive the Set of keys that
// changed plus the (mutated in place) settings object.
const bcSettingsListeners = [];

function bcOnSettingsChanged(fn) {
  if (typeof fn === 'function') bcSettingsListeners.push(fn);
}

function bcNotifySettingsChanged(changed) {
  for (const fn of bcSettingsListeners) {
    // One consumer throwing must not cost the others their update - and must
    // never reach the page.
    try {
      fn(changed, bcSettings);
    } catch (e) {
      console.warn('[Better Claude / settings] change listener threw:', e);
    }
  }
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

// === Live updates ===
// A save in the options page - or a value synced in from another device -
// arrives here, in every context that loaded this file: each open claude.ai
// tab, and the options page itself.

function bcHandleStorageChanged(changes, area) {
  if (area !== 'sync') return;

  // Start from what we hold and overlay only the keys the event mentions.
  // A key that was *removed* has no `newValue`, and undefined is exactly what
  // makes bcValidateSettings fall back to the default - which is the right
  // answer, rather than keeping the value we happen to still be holding.
  const raw = { ...bcSettings };
  let touched = false;
  for (const key of Object.keys(BC_SETTINGS_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    raw[key] = changes[key].newValue;
    touched = true;
  }
  if (!touched) return;

  const changed = bcApplyAndDiff(raw);
  // The writer applied its own change locally before the storage round trip,
  // so its own echo diffs to nothing and stops here. No feedback loop, and no
  // consumer is asked to redo work it already did.
  if (changed.size === 0) return;

  bcSettingsLog('changed:', [...changed].join(', '), bcSettings);
  bcNotifySettingsChanged(changed);
}

try {
  browser.storage.onChanged.addListener((changes, area) => {
    // Held behind the initial read: an event that arrives while the opening
    // get() is still in flight would otherwise be overwritten by that older
    // snapshot the moment it resolves.
    bcSettingsReady.then(() => bcHandleStorageChanged(changes, area));
  });
} catch (e) {
  console.warn('[Better Claude / settings] storage.onChanged unavailable:', e);
}
