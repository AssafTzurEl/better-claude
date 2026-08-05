// Better Claude - RTL module
// Automatic RTL alignment for Hebrew/Arabic content in chats, plus
// Ctrl+Right Shift / Ctrl+Left Shift to set input direction (container-level).
// https://github.com/AssafTzurEl/better-claude

// === Configuration ===
const DEBOUNCE_MS = 100;

// === Logging ===
function log(...args) {
  if (bcSettings.debugLogging) console.log('[Better Claude]', ...args);
}

// === Detection ===
const RTL_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LTR_REGEX = /[A-Za-z\u00C0-\u024F]/g;

function getRelevantText(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName;
      if (tag === 'CODE' || tag === 'UL' || tag === 'OL') continue;
      text += getRelevantText(node);
    }
  }
  return text;
}

function detectDirectionFromText(text) {
  const rtlCount = (text.match(RTL_REGEX) || []).length;
  const ltrCount = (text.match(LTR_REGEX) || []).length;

  if (rtlCount === 0 && ltrCount === 0) return 'ltr';
  if (rtlCount === 0) return 'ltr';
  return ltrCount > rtlCount * bcSettings.ltrRatioThreshold ? 'ltr' : 'rtl';
}

function detectDirection(element) {
  return detectDirectionFromText(getRelevantText(element));
}

// === Application ===
function setDirection(el, dir) {
  el.style.direction = dir;
  el.style.textAlign = dir === 'rtl' ? 'right' : 'left';
}

function clearDirection(el) {
  el.style.direction = '';
  el.style.textAlign = '';
}

function forceCodeChildrenLtr(element) {
  element.querySelectorAll('code').forEach(code => {
    code.style.direction = 'ltr';
    code.style.textAlign = 'left';
  });
}

function applyDirectionToChat() {
  let stats = { rtl: 0, ltr: 0 };

  // 1. Top-level lists only. Nested lists inherit via CSS direction inheritance.
  const allLists = document.querySelectorAll(
    '.font-claude-response ul, .font-claude-response ol, ' +
    '[data-testid="user-message"] ul, [data-testid="user-message"] ol'
  );
  const topLevelLists = [...allLists].filter(
    list => !list.parentElement.closest('ul, ol')
  );
  const nestedLists = [...allLists].filter(
    list => list.parentElement.closest('ul, ol')
  );

  // Clear any direction on nested lists so they inherit cleanly from parent.
  nestedLists.forEach(clearDirection);

  topLevelLists.forEach(list => {
    const dir = detectDirection(list);
    setDirection(list, dir);
    forceCodeChildrenLtr(list);
    stats[dir]++;
  });

  // 2. Block-level text outside of lists
  const blocks = document.querySelectorAll([
    '.font-claude-response p:not(li p):not(ul p):not(ol p)',
    '.font-claude-response h1',
    '.font-claude-response h2',
    '.font-claude-response h3',
    '.font-claude-response h4',
    '.font-claude-response h5',
    '.font-claude-response h6',
    '.font-claude-response blockquote',
    '[data-testid="user-message"] p'
  ].join(', '));

  blocks.forEach(el => {
    const dir = detectDirection(el);
    setDirection(el, dir);
    forceCodeChildrenLtr(el);
    stats[dir]++;
  });

  log('Direction applied:', stats);
}

// === Input direction handling (container-level) ===
const INPUT_SELECTOR = '[data-testid="chat-input"]';

// When the input is switched to RTL, the editor's list markers (which use
// `list-style-position: outside` with no inline-start padding) render past the
// right edge, forcing an unnecessary horizontal scrollbar. Give RTL lists
// enough inline-start padding to keep the markers inside the box. Scoped to
// our own RTL style so Anthropic's default LTR rendering is untouched.
function injectInputStyles() {
  if (document.getElementById('better-claude-input-styles')) return;
  const style = document.createElement('style');
  style.id = 'better-claude-input-styles';
  style.textContent = `
    ${INPUT_SELECTOR}[style*="direction: rtl"] ol,
    ${INPUT_SELECTOR}[style*="direction: rtl"] ul {
      padding-inline-start: 1.5em;
    }
    /* User-message lists use a left padding (pl-7/pl-8) for LTR markers, but
       no inline-start padding. When we flip them to RTL the markers render at
       the right edge and get clipped by the bubble's overflow:hidden. Move the
       padding to the inline-start side so the markers stay inside. */
    [data-testid="user-message"] ul[style*="direction: rtl"],
    [data-testid="user-message"] ol[style*="direction: rtl"],
    [data-testid="user-message"] [style*="direction: rtl"] ul,
    [data-testid="user-message"] [style*="direction: rtl"] ol {
      padding-inline-start: 1.75em;
      padding-left: 0;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  log('Input styles injected');
}

// Ctrl+Shift is an explicit choice, so it outranks the configured default - and
// keeps outranking it. The direction last picked by hand is remembered for the
// tab and carried to every composer mounted afterwards (a new chat, a
// re-rendered input), until the tab is reloaded. Re-asserting the default after
// each sent message would fight a user deliberately writing in the other
// script; the setting is the starting point, not a correction that keeps
// coming back.
let bcInputDirOverride = null;

function handleInputKeydown(e) {
  if (e.key !== 'Shift' || !e.ctrlKey) return;

  const input = e.currentTarget;
  let dir = null;
  if (e.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT) dir = 'rtl';
  else if (e.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT) dir = 'ltr';
  if (!dir) return;

  setDirection(input, dir);
  input.dataset.betterClaudeUserDir = dir; // never overwrite this element again
  bcInputDirOverride = dir;
  log('Input set to', dir.toUpperCase(), '(manual)');
}

// Gives a freshly mounted composer its starting direction. An element the user
// has already set by hand is left untouched.
function applyInputDirection(input) {
  if (input.dataset.betterClaudeUserDir) return;

  const carried = bcInputDirOverride !== null;
  const dir = carried ? bcInputDirOverride : bcSettings.defaultInputDirection;
  setDirection(input, dir);
  if (carried) input.dataset.betterClaudeUserDir = dir;
  log('Input direction set to', dir, carried ? '(carried over)' : '(default)');
}

function attachInputHandler() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return;
  if (input.dataset.betterClaudeAttached === 'true') return;

  input.addEventListener('keydown', handleInputKeydown);
  input.dataset.betterClaudeAttached = 'true';
  applyInputDirection(input);
  log('Input handler attached');
}

// === MutationObserver ===
let debounceTimer = null;

// Stays false until settings have loaded. The observer is registered at top
// level so nothing is missed, but its work must not run before then: attaching
// the input handler with the built-in defaults would mark the composer done,
// and the user's configured direction would never reach it. Nothing is lost by
// skipping - the initial pass below runs a full update as soon as it can.
let bcRtlReady = false;

function scheduleUpdate() {
  if (!bcRtlReady) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    applyDirectionToChat();
    attachInputHandler();
  }, DEBOUNCE_MS);
}

const observer = new MutationObserver((mutations) => {
  const relevant = mutations.some(m =>
    m.type === 'childList' || m.type === 'characterData'
  );
  if (relevant) scheduleUpdate();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// Initial pass, held until the settings are in - the first composer we touch
// has to get the configured direction, not the built-in default.
// bcSettingsReady never rejects: on a storage failure it resolves with the
// defaults, so this always runs.
bcSettingsReady.then(() => {
  bcRtlReady = true;
  injectInputStyles();
  applyDirectionToChat();
  attachInputHandler();
  log('Better Claude: ready');
});

// === Live settings updates ===
// Only the threshold needs anything done: it changes what the detector decides,
// so the chat has to be re-scanned. Re-running the pass is safe - it recomputes
// every block and overwrites the inline styles in both directions, so it
// self-corrects rather than accumulating.
//
// debugLogging: nothing to do, log() reads it at call time.
// defaultInputDirection: deliberately nothing. It is the direction a composer
// *starts* in, and flipping the box out from under someone mid-sentence would
// be a worse answer than waiting for the next mount.
bcOnSettingsChanged(changed => {
  if (!bcRtlReady) return;
  if (changed.has('ltrRatioThreshold')) {
    log('Threshold changed to', bcSettings.ltrRatioThreshold, '- re-scanning');
    applyDirectionToChat();
  }
});