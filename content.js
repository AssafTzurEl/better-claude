// Better Claude - Firefox extension
// https://github.com/AssafTzurEl/better-claude

// === Configuration ===
const LTR_RATIO_THRESHOLD = 1.2; // LTR wins only if ltrCount > rtlCount * this
const DEBOUNCE_MS = 100;
const DEBUG = false; // Set to true for development logging

// === Logging ===
function log(...args) {
  if (DEBUG) console.log('[Better Claude]', ...args);
}

// === Detection ===
const RTL_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LTR_REGEX = /[A-Za-z\u00C0-\u024F]/g;

// Walk a DOM element and collect text, but skip anything inside <code>, <ul>, or <ol>.
// Excludes inline code from paragraph counts and excludes nested lists from outer list counts.
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
  // RTL is the default; LTR wins only if it dominates by the configured ratio
  return ltrCount > rtlCount * LTR_RATIO_THRESHOLD ? 'ltr' : 'rtl';
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
  // v1: inline code is always LTR. Future: detect per-code-element direction.
  element.querySelectorAll('code').forEach(code => {
    code.style.direction = 'ltr';
    code.style.textAlign = 'left';
  });
}

function applyDirectionToChat() {
  let stats = { rtl: 0, ltr: 0 };

  // 1. Top-level lists only. Nested lists inherit via CSS direction inheritance.
  const allLists = document.querySelectorAll(
    '.font-claude-response ul, .font-claude-response ol'
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

// === MutationObserver ===
let debounceTimer = null;

function scheduleUpdate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    applyDirectionToChat();
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

// Initial pass
applyDirectionToChat();

log('Better Claude: ready');