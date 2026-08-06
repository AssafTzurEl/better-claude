// Better Claude - Settings page
// Renders the options UI, loads current values from storage and writes each
// change back immediately (no Save button - the WebExtension norm).
// Defaults and validation are NOT duplicated here: options.html loads
// settings.js first, so BC_SETTINGS_DEFAULTS, bcValidateSettings, bcSettings
// and bcSettingsReady are already in scope.
// https://github.com/AssafTzurEl/better-claude

// === Strings ===
// English only for now. Every user-facing string lives here so browser.i18n
// can be layered on later without restructuring the page.
const BC_STRINGS = {
  subtitle: 'Changes are saved as you make them.',

  headingDirection: 'Text direction',
  headingUsage: 'Usage bars',
  headingAdvanced: 'Advanced',

  thresholdLabel: 'Mixed-language paragraphs',
  thresholdHint:
    'A paragraph that mixes Latin letters with Hebrew or Arabic is laid out ' +
    'left-to-right only once the Latin letters outnumber the others by enough. ' +
    'Move the slider toward "Prefer RTL" if such paragraphs are being flipped ' +
    'to the left too eagerly, and toward "Prefer LTR" if they are not flipped ' +
    'when they should be.',
  thresholdEndMin: 'Prefer LTR',
  thresholdEndMax: 'Prefer RTL',
  thresholdReadoutPrefix:
    'Switches to left-to-right at a Latin : Hebrew/Arabic letter ratio of ',
  thresholdReadoutSuffix: '.',

  directionLabel: 'Default direction of the message box',
  directionHint:
    'Ctrl + right Shift / Ctrl + left Shift still switches the direction of ' +
    'the box you are typing in.',
  directionLtr: 'Left-to-right',
  directionRtl: 'Right-to-left',

  usageBarsLabel: 'Show session and weekly usage bars',
  usageBarsHint: 'The thin bars in the chat header showing how much of your plan is used.',

  debugLoggingLabel: 'Debug logging',
  debugLoggingHint:
    'Writes [Better Claude] messages to the claude.ai console (F12). Handy ' +
    'when reporting a problem; off otherwise.',

  restore: 'Restore defaults',
  saved: 'Saved',
  saveFailed: 'Could not save - storage is unavailable.',
};

// === Slider scale ===
// The slider runs over a position `p` (-10 .. +10, whole steps); storage holds
// the ratio. The 0.1 increments are applied to the ratio the user *sees*, and
// the stored threshold is derived from it - that is what makes the two halves
// mirror images (p = -4 stores 1/1.4, p = +4 stores 1.4).
// This scale is presentation, which is why it lives here and not in settings.js.

const BC_POS_MIN = -10;
const BC_POS_MAX = 10;

// Slider position -> stored threshold. p >= 0: 1 + p/10. p < 0: its reciprocal.
// Rounded to 3 decimals, matching BC_LTR_RATIO_DECIMALS: 1/1.2 = 0.8333... and
// one decimal would collapse it onto a different stop.
const bcPosToRatio = p =>
  p >= 0 ? 1 + p / 10 : Math.round(1000 / (1 - p / 10)) / 1000;

// Stored threshold -> nearest slider position. A stored value between stops
// (older version, hand-edited profile) snaps the thumb but not the readout.
const bcRatioToPos = t => Math.round((t >= 1 ? t - 1 : 1 - 1 / t) * 10);

const bcClampPos = p => Math.min(BC_POS_MAX, Math.max(BC_POS_MIN, p));

// "1.2 : 1" above balance, "1 : 1.9" below it. Two decimals, trailing zeros
// dropped: every stop reads back as the 0.1 step it was, and an off-stop value
// still shows itself honestly ("2.53 : 1") rather than claiming a stop.
function bcFormatRatioSide(n) {
  return String(Math.round(n * 100) / 100);
}

function bcFormatRatio(t) {
  return t >= 1
    ? `${bcFormatRatioSide(t)} : 1`
    : `1 : ${bcFormatRatioSide(1 / t)}`;
}

// === Elements ===
const bcEl = id => document.getElementById(id);

const bcControls = {
  threshold: bcEl('bc-threshold'),
  directionLtr: bcEl('bc-direction-ltr'),
  directionRtl: bcEl('bc-direction-rtl'),
  usageBars: bcEl('bc-usage-bars'),
  debugLogging: bcEl('bc-debug-logging'),
  restore: bcEl('bc-restore'),
  status: bcEl('bc-status'),
  readout: bcEl('bc-threshold-readout'),
};

// === Static text ===
function bcRenderStrings() {
  const s = BC_STRINGS;
  const text = {
    'bc-subtitle': s.subtitle,
    'bc-heading-direction': s.headingDirection,
    'bc-heading-usage': s.headingUsage,
    'bc-heading-advanced': s.headingAdvanced,
    'bc-threshold-label': s.thresholdLabel,
    'bc-threshold-hint': s.thresholdHint,
    'bc-threshold-end-min': s.thresholdEndMin,
    'bc-threshold-end-max': s.thresholdEndMax,
    'bc-direction-label': s.directionLabel,
    'bc-direction-hint': s.directionHint,
    'bc-direction-ltr-label': s.directionLtr,
    'bc-direction-rtl-label': s.directionRtl,
    'bc-usage-bars-label': s.usageBarsLabel,
    'bc-usage-bars-hint': s.usageBarsHint,
    'bc-debug-logging-label': s.debugLoggingLabel,
    'bc-debug-logging-hint': s.debugLoggingHint,
    'bc-restore': s.restore,
  };
  for (const [id, value] of Object.entries(text)) bcEl(id).textContent = value;
  // Language and its direction are set together, so a future browser.i18n layer
  // has one place to change. `dir` is not merely the default restated: the page
  // is embedded in about:addons, and stating it keeps the layout the strings'
  // rather than the browser locale's.
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
}

// === Rendering ===
function bcRenderReadout(t) {
  const strong = document.createElement('strong');
  strong.textContent = bcFormatRatio(t);
  bcControls.readout.replaceChildren(
    BC_STRINGS.thresholdReadoutPrefix, strong, BC_STRINGS.thresholdReadoutSuffix
  );
}

// Renders every control from the given settings object. The thumb snaps to the
// nearest stop; the readout is drawn from the stored value, so an off-stop
// threshold keeps showing its real ratio until the slider is actually moved.
function bcRenderSettings(settings) {
  bcControls.threshold.value = String(bcClampPos(bcRatioToPos(settings.ltrRatioThreshold)));
  bcRenderReadout(settings.ltrRatioThreshold);
  bcControls.directionLtr.checked = settings.defaultInputDirection === 'ltr';
  bcControls.directionRtl.checked = settings.defaultInputDirection === 'rtl';
  bcControls.usageBars.checked = settings.usageBarsEnabled;
  bcControls.debugLogging.checked = settings.debugLogging;
}

let bcStatusTimer = null;

function bcShowStatus(message, isError = false) {
  const el = bcControls.status;
  el.textContent = message;
  el.dataset.bcVisible = 'true';
  el.dataset.bcError = String(isError);
  if (bcStatusTimer) clearTimeout(bcStatusTimer);
  bcStatusTimer = setTimeout(() => {
    bcStatusTimer = null;
    el.dataset.bcVisible = 'false';
  }, isError ? 6000 : 1800);
}

// === Saving ===
// Validate the merged result rather than the patch alone: bcValidateSettings
// fills in every key, so handing it a partial object would reset the rest.
async function bcSave(patch) {
  const merged = bcValidateSettings({ ...bcSettings, ...patch });
  // Update the local copy *before* awaiting the write. A storage.sync round
  // trip is slow enough that a second control can be changed while the first
  // is still in flight; if both merged from the pre-write state, the later
  // write would silently revert the earlier one.
  bcApplySettings(merged);
  try {
    await browser.storage.sync.set(merged);
    bcShowStatus(BC_STRINGS.saved);
  } catch (e) {
    console.error('[Better Claude / options] save failed:', e);
    bcShowStatus(BC_STRINGS.saveFailed, true);
  }
}

// === Wiring ===
function bcAttachHandlers() {
  // Readout follows the thumb live; the write waits for the drag to end, so a
  // single sweep is one storage write rather than twenty.
  bcControls.threshold.addEventListener('input', () => {
    bcRenderReadout(bcPosToRatio(Number(bcControls.threshold.value)));
  });
  bcControls.threshold.addEventListener('change', () => {
    bcSave({ ltrRatioThreshold: bcPosToRatio(Number(bcControls.threshold.value)) });
  });

  for (const radio of [bcControls.directionLtr, bcControls.directionRtl]) {
    radio.addEventListener('change', () => {
      if (radio.checked) bcSave({ defaultInputDirection: radio.value });
    });
  }

  bcControls.usageBars.addEventListener('change', () => {
    bcSave({ usageBarsEnabled: bcControls.usageBars.checked });
  });

  bcControls.debugLogging.addEventListener('change', () => {
    bcSave({ debugLogging: bcControls.debugLogging.checked });
  });

  bcControls.restore.addEventListener('click', async () => {
    await bcSave({ ...BC_SETTINGS_DEFAULTS });
    bcRenderSettings(bcSettings);
  });
}

// === Init ===
// bcSettingsReady never rejects: on a storage failure it resolves with the
// defaults, so the page always renders something usable.
(async () => {
  bcRenderStrings();
  bcRenderSettings(await bcSettingsReady);
  bcAttachHandlers();

  // The page is a consumer of live updates like any other: a value synced in
  // from another device, or a second copy of this page, should not leave these
  // controls showing something that is no longer true. Our own saves never get
  // here - bcSave applies them locally first, so their echo diffs to nothing.
  bcOnSettingsChanged(() => bcRenderSettings(bcSettings));
})();
