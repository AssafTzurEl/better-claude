// Better Claude - Usage bars module
// Fetches and parses Claude plan usage (session + weekly) from the API,
// and renders them as thin bars in the chat header (wide) or below the
// chat title (narrow). Falls back to a fixed strip if the header is not found.

// === Configuration ===
// Whether the bars are shown is `bcSettings.usageBarsEnabled`, and console
// logging is `bcSettings.debugLogging` - both read at call time so a change
// takes effect without a reload.
//
// The debug exports below are a third thing, and deliberately not user-facing:
// they publish fetchUsage/remountUsageWidget onto the *page's* window, and a
// checkbox in the options page must not add API surface to claude.ai. Flip this
// by hand while developing; it stays false in shipped code.
const USAGE_DEV_EXPORTS = false;

// Whether the feature is currently running. False until settings have loaded,
// so the observers registered at top level stay no-ops until then, and false
// again after teardownUsage() - a flag alone would not be enough, since those
// observers would otherwise cheerfully re-mount a widget the user just turned
// off.
let usageActive = false;

// Minimum pixel width for the widget to be useful in the header.
// Two progress bars need label + percent + track — less than this is too cramped.
// This is a content constraint, not a viewport breakpoint.
const WIDGET_MIN_USEFUL_PX = 280;

// Minimum milliseconds between API calls (debounce / min-interval).
const MIN_REFRESH_INTERVAL_MS = 5000;
// Poll cadence while Claude is generating a response.
const POLL_INTERVAL_MS = 10000;

// === Logging ===
function usageLog(...args) {
  if (bcSettings.debugLogging) console.log('[Better Claude / usage]', ...args);
}

// === Org ID resolution ===

let cachedOrgId = null;

function getOrgIdFromCookie() {
  return document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1] ?? null;
}

async function getOrgIdFromApi() {
  try {
    const res = await fetch('/api/organizations', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    // data is an array of org objects; pick the first one
    return Array.isArray(data) && data.length > 0 ? (data[0].id ?? null) : null;
  } catch {
    return null;
  }
}

async function resolveOrgId() {
  if (cachedOrgId) return cachedOrgId;
  const fromCookie = getOrgIdFromCookie();
  if (fromCookie) {
    cachedOrgId = fromCookie;
    usageLog('orgId from cookie:', cachedOrgId);
    return cachedOrgId;
  }
  const fromApi = await getOrgIdFromApi();
  if (fromApi) {
    cachedOrgId = fromApi;
    usageLog('orgId from API fallback:', cachedOrgId);
    return cachedOrgId;
  }
  usageLog('orgId not found');
  return null;
}

// === Fetch + parse ===

/**
 * Returns { session, weekly } usage objects, or null on any failure.
 *
 * session / weekly shape:
 *   { percent: number, severity: string, resetsAt: Date, isActive: boolean }
 */
async function fetchUsage() {
  if (!bcSettings.usageBarsEnabled) return null;

  const orgId = await resolveOrgId();
  if (!orgId) return null;

  let data;
  try {
    const res = await fetch(`/api/organizations/${orgId}/usage`, { credentials: 'include' });
    if (!res.ok) {
      usageLog('fetch failed:', res.status);
      return null;
    }
    data = await res.json();
  } catch (err) {
    usageLog('fetch error:', err);
    return null;
  }

  if (!Array.isArray(data?.limits)) {
    usageLog('unexpected response shape', data);
    return null;
  }

  const byKind = {};
  for (const limit of data.limits) {
    if (limit.kind === 'session' || limit.kind === 'weekly_all') {
      byKind[limit.kind] = limit;
    }
  }

  if (!byKind.session && !byKind.weekly_all) {
    usageLog('no recognized limits in response');
    return null;
  }

  function parseLimit(raw) {
    if (!raw) return null;
    return {
      percent:   typeof raw.percent === 'number' ? raw.percent : 0,
      severity:  typeof raw.severity === 'string' ? raw.severity : 'normal',
      resetsAt:  raw.resets_at ? new Date(raw.resets_at) : null,
      isActive:  Boolean(raw.is_active),
    };
  }

  const result = {
    session: parseLimit(byKind.session),
    weekly:  parseLimit(byKind.weekly_all),
  };

  usageLog('usage data:', result);
  return result;
}

// === Color mapping (DESIGN §4) ===

function severityToColor(severity) {
  if (severity === 'normal')   return '#3b82f6'; // blue
  if (severity === 'warning')  return '#fab219'; // yellow
  if (severity === 'critical') return '#d03b3b'; // red
  return '#d03b3b';                              // red (unknown — treat as critical)
}

// === Reset-time formatting (DESIGN §5.2) ===

function formatSessionReset(date) {
  if (!date) return 'Starts when a message is sent';
  const diffMs = date - Date.now();
  if (diffMs <= 0) return 'Resetting soon';
  const totalMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `Resets in ${mins} min`;
  if (mins === 0) return `Resets in ${hours} hr`;
  return `Resets in ${hours} hr ${mins} min`;
}

function formatWeeklyReset(date) {
  if (!date) return 'Reset time unknown';
  const diffDays = (date - Date.now()) / 86400000;
  if (diffDays < 7) {
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `Resets ${day} ${time}`;
  }
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getMonth()];
  return `Resets ${month} ${date.getDate()}`;
}

// === Refresh control (DESIGN §6) ===

let lastRefreshAt = 0;
let lastUpdatedAt = null; // Date.now() timestamp of the last successful fetch
let refreshTimer = null;
let pollTimer = null;
let isGenerating = false;

function formatLastUpdated(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60000) return 'just now';
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function updateLastUpdatedLabel() {
  const el = document.getElementById('bc-usage-updated');
  if (el) el.textContent = formatLastUpdated(lastUpdatedAt);
}

// Freshen the "X min ago" text every 15 s without an API call.
// 15 s means the first tick past the 60 s "just now" threshold lands at ~75 s.
setInterval(updateLastUpdatedLabel, 15000);

// Fetch and re-render. Callers are responsible for gating — use scheduleRefresh
// unless bypassing the interval intentionally.
async function doRefresh() {
  if (!usageActive) return;
  usageLog('refreshing');
  lastRefreshAt = Date.now();
  const data = await fetchUsage();
  // The request is slow enough that the user can uncheck the box while it is
  // in flight; without this the response would mount a widget after teardown.
  if (!usageActive) return;
  if (data) lastUpdatedAt = Date.now();
  mountUsageWidget(data);
}

// Collapse multiple triggers into one request; extend the delay to honour the
// min interval if a recent fetch just happened.
function scheduleRefresh(delayMs = 0) {
  if (!usageActive) return;
  const remaining = MIN_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt);
  const effectiveDelay = Math.max(delayMs, remaining > 0 ? remaining : 0);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(doRefresh, effectiveDelay);
}

// Bypass the min interval (manual ↻ or initial load).
async function forceRefresh() {
  if (!usageActive) return;
  clearTimeout(refreshTimer);
  lastRefreshAt = 0;
  await doRefresh();
}

function startPoll() {
  if (pollTimer) return;
  usageLog('10s poll started');
  pollTimer = setInterval(() => scheduleRefresh(0), POLL_INTERVAL_MS);
}

function stopPoll() {
  if (!pollTimer) return;
  usageLog('10s poll stopped');
  clearInterval(pollTimer);
  pollTimer = null;
}

// === Generation detector ===
// Watches for the stop-generation button that Claude renders while streaming.
// Presence → generation started; disappearance → generation ended.

const STOP_BTN_SELECTORS = [
  '[data-testid="stop-response"]',
  'button[aria-label="Stop"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="stop" i]',
];

function stopButtonPresent() {
  return STOP_BTN_SELECTORS.some(sel => {
    try { return !!document.querySelector(sel); } catch { return false; }
  });
}

new MutationObserver(() => {
  if (!usageActive) return;
  const nowGenerating = stopButtonPresent();
  if (nowGenerating === isGenerating) return;
  isGenerating = nowGenerating;
  if (isGenerating) {
    usageLog('generation started — 10s poll active');
    startPoll();
  } else {
    usageLog('generation ended — stopping poll');
    stopPoll();
    // Brief pause so the API can finalize the usage count before we fetch.
    scheduleRefresh(1500);
  }
}).observe(document.body, { childList: true, subtree: true });

// === Event detectors (message send + manual ↻) ===

const COMPOSER_SELECTORS = [
  '[data-testid="chat-input"]',
  '.ProseMirror',
  '[contenteditable="true"]',
];

const SEND_BTN_SELECTORS_DETECT = [
  '[data-testid="send-button"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
];

function handleKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const target = e.target;
  if (!target) return;
  const inComposer = COMPOSER_SELECTORS.some(sel => {
    try { return target.matches(sel) || !!target.closest(sel); } catch { return false; }
  });
  if (inComposer) {
    usageLog('send detected (Enter key)');
    scheduleRefresh(2000);
  }
}

function handleClick(e) {
  const target = e.target;
  if (!target) return;

  // Manual ↻ button — bypass min interval.
  if (target.closest?.('#bc-usage-refresh-btn')) {
    usageLog('manual refresh');
    const btn = document.getElementById('bc-usage-refresh-btn');
    if (btn && !btn.classList.contains('bc-spinning')) {
      btn.classList.add('bc-spinning');
      btn.addEventListener('animationend', () => btn.classList.remove('bc-spinning'), { once: true });
    }
    forceRefresh();
    return;
  }

  // Send button.
  const isSend = SEND_BTN_SELECTORS_DETECT.some(sel => {
    try { return target.matches(sel) || !!target.closest(sel); } catch { return false; }
  });
  if (isSend) {
    usageLog('send detected (send button)');
    scheduleRefresh(2000);
  }
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  usageLog('tab visible — scheduling refresh');
  scheduleRefresh(0);
}

// Named handlers, so teardown can take them off again — and so re-enabling
// mid-session cannot end up with two of each.
function setupEventDetectors() {
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function removeEventDetectors() {
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

// === Styles ===

function injectUsageStyles() {
  if (document.getElementById('bc-usage-styles')) return;
  const style = document.createElement('style');
  style.id = 'bc-usage-styles';
  style.textContent = `
    /* Header placement (wide window) — absolutely centered in the <header>
       element (position:sticky = the CSS containing block). Absolute positioning
       removes the widget from the flex flow so neither the title's flex:1 nor
       the actions-div width affects its horizontal center. */
    #bc-usage-widget[data-bc-placement="header"] {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      top: 0;
      bottom: 0;
      width: 460px; /* overridden by checkPlacement on first resize tick */
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 12px;
      min-width: 0;
      box-sizing: border-box;
      font-size: 12px;
      font-family: inherit;
      line-height: 1;
    }

    /* Below-title placement (narrow window) — block row under the chat title */
    #bc-usage-widget[data-bc-placement="below-title"] {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 4px 12px;
      width: 100%;
      max-width: 720px;
      font-size: 12px;
      font-family: inherit;
      line-height: 1;
      box-sizing: border-box;
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);
    }

    /* Fixed strip fallback — absolutely positioned over the content area */
    #bc-usage-widget[data-bc-placement="fixed"] {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 720px;
      max-width: 100%;
      display: flex;
      gap: 16px;
      padding: 6px 12px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);
      border-bottom-left-radius: 6px;
      border-bottom-right-radius: 6px;
      z-index: 99999;
      box-sizing: border-box;
      font-size: 12px;
      font-family: inherit;
      line-height: 1;
    }

    /* Color tokens — matched to Claude's own usage display palette */
    #bc-usage-widget {
      --bc-text:      #0b0b0b;
      --bc-secondary: #52514e;
    }
    @media (prefers-color-scheme: dark) {
      #bc-usage-widget {
        --bc-text:      #ffffff;
        --bc-secondary: #c3c2b7;
      }
    }

    /* Shared lane styles */
    .bc-usage-lane {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 1;
      min-width: 0;
      cursor: default;
      user-select: none;
    }
    .bc-usage-label {
      white-space: nowrap;
      color: var(--bc-text);
      flex-shrink: 0;
    }
    .bc-usage-pct {
      white-space: nowrap;
      color: var(--bc-secondary);
      flex-shrink: 0;
      min-width: 28px;
    }
    .bc-usage-track {
      flex: 1;
      height: 4px;
      background: rgba(128, 128, 128, 0.2);
      border-radius: 2px;
      overflow: hidden;
      min-width: 40px;
    }
    .bc-usage-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    /* "Last updated" label — only shown in header (wide) placement */
    .bc-usage-updated {
      white-space: nowrap;
      color: var(--bc-secondary);
      font-size: 11px;
      flex-shrink: 0;
    }
    #bc-usage-widget[data-bc-placement="below-title"] .bc-usage-updated,
    #bc-usage-widget[data-bc-placement="fixed"] .bc-usage-updated {
      display: none;
    }

    /* Manual refresh button */
    .bc-usage-refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      color: var(--bc-secondary);
      padding: 0 2px;
      flex-shrink: 0;
      line-height: 1;
      display: flex;
      align-items: center;
    }
    .bc-usage-refresh-btn:hover {
      color: var(--bc-text);
    }
    @keyframes bc-spin {
      to { transform: rotate(360deg); }
    }
    .bc-usage-refresh-btn.bc-spinning svg {
      animation: bc-spin 0.6s linear;
    }
  `;
  document.head.appendChild(style);
}

// === DOM building ===

function buildUsageLane(label, data, formatReset) {
  const lane = document.createElement('div');
  lane.className = 'bc-usage-lane';
  lane.title = data ? formatReset(data.resetsAt) : 'No data';

  const labelEl = document.createElement('span');
  labelEl.className = 'bc-usage-label';
  labelEl.textContent = label;

  const pctEl = document.createElement('span');
  pctEl.className = 'bc-usage-pct';
  pctEl.textContent = data ? `${data.percent}%` : '—';

  const track = document.createElement('div');
  track.className = 'bc-usage-track';

  const fill = document.createElement('div');
  fill.className = 'bc-usage-fill';
  fill.style.width = data ? `${Math.min(100, Math.max(0, data.percent))}%` : '0%';
  fill.style.backgroundColor = data ? severityToColor(data.severity) : '#6b7280';

  track.appendChild(fill);
  lane.appendChild(labelEl);
  lane.appendChild(pctEl);
  lane.appendChild(track);

  return lane;
}

// Read the actual rendered background of the page body (for fixed fallback only).
function getPageBackground() {
  for (const el of [document.body, document.documentElement]) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  }
  return null;
}

// === Header anchor detection ===

// Tried in order; first match wins.
const HEADER_SELECTORS = [
  '[data-testid="conversation-header"]',
  '[data-testid="chat-header"]',
  '[data-testid="page-header"]',
  '#main-content header',
  'main header',
];

// Title element for below-title placement (narrow window).
const TITLE_SELECTORS = [
  '[data-testid="chat-title"]',
  '[data-testid="conversation-title"]',
  '#main-content header h1',
  '#main-content header h2',
  '#main-content h1',
];

function firstMatch(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector — skip */ }
  }
  return null;
}

// === Mount ===

let lastUsageData = null;

// Set to true by the placement observer when the header is too cramped,
// preventing tryMountInHeader from succeeding until space is available again.
let headerTooNarrow = false;

function mountUsageWidget(usageData) {
  lastUsageData = usageData;
  document.getElementById('bc-usage-widget')?.remove();

  if (!usageData) return;

  injectUsageStyles();

  const widget = document.createElement('div');
  widget.id = 'bc-usage-widget';
  widget.appendChild(buildUsageLane('Session', usageData.session, formatSessionReset));
  widget.appendChild(buildUsageLane('Weekly',  usageData.weekly,  formatWeeklyReset));

  // Last-updated label — hidden in narrow placements via CSS.
  const updatedEl = document.createElement('span');
  updatedEl.id = 'bc-usage-updated';
  updatedEl.className = 'bc-usage-updated';
  updatedEl.textContent = formatLastUpdated(lastUpdatedAt);
  widget.appendChild(updatedEl);

  // Manual refresh button.
  const refreshBtn = document.createElement('button');
  refreshBtn.id = 'bc-usage-refresh-btn';
  refreshBtn.className = 'bc-usage-refresh-btn';
  const svgNS = 'http://www.w3.org/2000/svg';
  const refreshSvg = document.createElementNS(svgNS, 'svg');
  refreshSvg.setAttribute('width', '16');
  refreshSvg.setAttribute('height', '16');
  refreshSvg.setAttribute('viewBox', '0 0 20 20');
  refreshSvg.setAttribute('fill', 'currentColor');
  refreshSvg.setAttribute('aria-hidden', 'true');
  const refreshPath = document.createElementNS(svgNS, 'path');
  refreshPath.setAttribute('d', 'M10.386 2.51A7.5 7.5 0 1 1 5.499 4H3a.5.5 0 0 1 0-1h3.5a.5.5 0 0 1 .49.402L7 3.5V7a.5.5 0 0 1-1 0V4.879a6.5 6.5 0 1 0 4.335-1.37L10 3.5l-.1-.01a.5.5 0 0 1 .1-.99z');
  refreshSvg.appendChild(refreshPath);
  refreshBtn.appendChild(refreshSvg);
  refreshBtn.title = 'Refresh usage';
  widget.appendChild(refreshBtn);

  if (!headerTooNarrow && tryMountInHeader(widget)) {
    // Wide: in the header band.
  } else if (tryMountBelowTitle(widget)) {
    // Narrow: below the chat title.
  } else {
    // Fallback: fixed strip (injection guard — no recognized header/title found).
    tryMountFixed(widget);
  }

  usageLog('widget mounted, placement:', widget.dataset.bcPlacement);
}

function tryMountInHeader(widget) {
  const header = firstMatch(HEADER_SELECTORS);
  if (!header) {
    usageLog('header anchor not found — falling back to fixed strip');
    return false;
  }

  // Claude wraps the header's flex row in an inner div. Walk up from the title
  // element to find that direct child of the header (the actual flex container).
  let container = header;
  const titleEl = header.querySelector('[data-testid="chat-title-split"], [data-testid="chat-title"]');
  if (titleEl) {
    let el = titleEl;
    while (el.parentElement && el.parentElement !== header) {
      el = el.parentElement;
    }
    if (el.parentElement === header) container = el;
  }

  widget.dataset.bcPlacement = 'header';

  // Widget is position:absolute relative to the <header> (position:sticky =
  // containing block), so its exact DOM position inside the container doesn't
  // affect layout. Append to keep it logically grouped with the header content.
  container.appendChild(widget);

  // Set initial width immediately so the first paint is correct.
  widget.style.width = `${Math.min(720, getHeaderFreeSpace(header))}px`;

  return true;
}

function tryMountBelowTitle(widget) {
  // For narrow layout, insert after the title element; fall back to after the header.
  const anchor = firstMatch(TITLE_SELECTORS) ?? firstMatch(HEADER_SELECTORS);
  if (!anchor) return false;

  widget.dataset.bcPlacement = 'below-title';

  // Claude's header uses -mb-3 (-12px) which pulls the next sibling up under
  // the sticky header. Push the widget back down so it's fully visible.
  const anchorMarginBottom = parseFloat(getComputedStyle(anchor).marginBottom);
  if (anchorMarginBottom < 0) {
    widget.style.marginTop = `${-anchorMarginBottom}px`;
  }

  anchor.insertAdjacentElement('afterend', widget);
  return true;
}

function tryMountFixed(widget) {
  widget.dataset.bcPlacement = 'fixed';
  const bg = getPageBackground();
  if (bg) widget.style.background = bg;

  const mainEl = document.getElementById('main-content');
  if (mainEl) {
    mainEl.appendChild(widget);
  } else {
    widget.style.position = 'fixed';
    document.body.appendChild(widget);
  }
}

// === Placement observer ===
// Uses the header's actual flex geometry to decide whether the bars belong
// in the header or below the title. Reacts to window resize, sidebar toggle,
// and any other layout change — not a fixed viewport breakpoint.

function getHeaderFreeSpace(header) {
  // The widget is absolutely centered in the header. The maximum width it can
  // occupy without overlapping the title content (left) or the Share button
  // (right) is 2× the smaller of (center-to-titleRight) and (center-to-shareLeft).
  const headerRect = header.getBoundingClientRect();
  const center = headerRect.left + headerRect.width / 2;

  // Right edge of the visible title content (the split button, not the flex-1 wrapper).
  const titleEl = header.querySelector('[data-testid="chat-title-split"]');
  const titleRight = titleEl
    ? titleEl.getBoundingClientRect().right
    : center - headerRect.width * 0.3; // fallback: assume title occupies 20%

  // Left edge of the Share button (absolutely positioned outside the flex row).
  const shareBtn = document.querySelector('[data-testid="wiggle-controls-actions-share"]');
  const shareLeft = shareBtn
    ? shareBtn.getBoundingClientRect().left
    : headerRect.right - 80; // fallback: reserve 80px for share cluster

  const maxHalfWidth = Math.min(center - titleRight, shareLeft - center);
  return Math.max(0, maxHalfWidth * 2);
}

function checkPlacement() {
  if (!lastUsageData) return;
  const widget = document.getElementById('bc-usage-widget');
  if (!widget) return; // SPA observer handles remount

  const header = firstMatch(HEADER_SELECTORS);
  if (!header) return; // no header = no placement switching possible

  const freeSpace = getHeaderFreeSpace(header);
  const placement = widget.dataset.bcPlacement;

  // Keep the header widget's width in sync with the safe available gap.
  if (placement === 'header') {
    widget.style.width = `${Math.min(720, freeSpace)}px`;
  }

  if (placement === 'header' && freeSpace < WIDGET_MIN_USEFUL_PX) {
    usageLog(`header too narrow (${Math.round(freeSpace)}px), moving below title`);
    headerTooNarrow = true;
    mountUsageWidget(lastUsageData);
  } else if (placement !== 'header' && freeSpace >= WIDGET_MIN_USEFUL_PX) {
    usageLog(`header wide enough (${Math.round(freeSpace)}px), moving to header`);
    headerTooNarrow = false;
    mountUsageWidget(lastUsageData);
  }
}

// Observe the document root: fires on window resize, zoom, and sidebar toggle
// (all of which change the header's available width). The callback is cheap —
// just two getBoundingClientRect calls and a comparison.
let placementCheckTimer = null;
new ResizeObserver(() => {
  if (!usageActive) return;
  clearTimeout(placementCheckTimer);
  placementCheckTimer = setTimeout(checkPlacement, 150);
}).observe(document.documentElement);

// === SPA navigation guard ===
// Claude re-renders the header on chat switches, which removes our injected
// widget. Watch for the widget disappearing from the DOM and re-mount it.

let spaRemountTimer = null;

new MutationObserver(() => {
  if (!usageActive) return;
  if (document.getElementById('bc-usage-widget')) return; // still present
  if (!lastUsageData) return;

  clearTimeout(spaRemountTimer);
  spaRemountTimer = setTimeout(() => {
    spaRemountTimer = null;
    usageLog('widget removed by SPA navigation, re-mounting');
    mountUsageWidget(lastUsageData);
  }, 300);
}).observe(document.body, { childList: true, subtree: true });

// === Init / teardown ===
// Both are idempotent and safe to call at any point in the tab's life, so the
// feature can be switched on and off mid-session without a reload.

async function initUsage() {
  if (!bcSettings.usageBarsEnabled || usageActive) return;
  usageActive = true;
  usageLog('init');
  setupEventDetectors();
  await forceRefresh();
}

// A flag is not enough on its own: the widget is in someone else's DOM, and
// three top-level observers plus two timers would keep bringing it back. This
// unwinds all of it. The injected <style> stays - it only ever matches our own
// widget, and leaving it makes re-enabling a little cheaper.
function teardownUsage() {
  if (!usageActive) return;
  usageLog('teardown');
  usageActive = false;

  clearTimeout(refreshTimer);
  refreshTimer = null;
  clearTimeout(spaRemountTimer);
  spaRemountTimer = null;
  clearTimeout(placementCheckTimer);
  placementCheckTimer = null;
  stopPoll();
  // Reset, or the generation observer would compare against a stale `true` on
  // re-enable and never start the poll.
  isGenerating = false;

  removeEventDetectors();
  document.getElementById('bc-usage-widget')?.remove();

  lastUsageData = null;
  lastUpdatedAt = null;
  headerTooNarrow = false;
}

// Held until settings are in: starting on the built-in default would flash the
// bars up for a moment in a profile that has them switched off.
// bcSettingsReady never rejects - on a storage failure it resolves with the
// defaults, so this always runs.
bcSettingsReady.then(() => {
  usageLog('settings ready, usage bars', bcSettings.usageBarsEnabled ? 'on' : 'off');
  // Caught for the same reason as the settings-change path below: initUsage() is
  // async, and a first mount that throws must stay our problem, not an unhandled
  // rejection in claude.ai's console.
  initUsage().catch(e => usageLog('initial init failed:', e));
});

// === Live settings updates ===
// The toggle is the whole reason initUsage()/teardownUsage() were written to be
// callable at any point in the tab's life. debugLogging needs nothing here -
// usageLog() reads it at call time.
bcOnSettingsChanged(changed => {
  if (!changed.has('usageBarsEnabled')) return;

  if (bcSettings.usageBarsEnabled) {
    usageLog('usage bars switched on');
    // The listener is synchronous; initUsage() is not. Catch here or a failed
    // first fetch surfaces as an unhandled rejection in the page console.
    initUsage().catch(e => usageLog('init after settings change failed:', e));
  } else {
    usageLog('usage bars switched off');
    teardownUsage();
  }
});

// === Debug exports (Firefox only) ===

if (USAGE_DEV_EXPORTS) {
  exportFunction(function() {
    fetchUsage().then(
      r => console.log('[Better Claude / usage] fetchUsage() =>', r),
      e => console.error('[Better Claude / usage] fetchUsage() threw:', e)
    );
  }, window, { defineAs: 'fetchUsage' });

  exportFunction(function() {
    forceRefresh().then(
      () => console.log('[Better Claude / usage] refreshed and remounted'),
      e  => console.error('[Better Claude / usage] refresh failed:', e)
    );
  }, window, { defineAs: 'remountUsageWidget' });

  // The checkbox drives this path in normal use; these stay for exercising it
  // from the page console without a round trip through the options page.
  exportFunction(function() {
    teardownUsage();
    console.log('[Better Claude / usage] torn down');
  }, window, { defineAs: 'teardownUsage' });

  exportFunction(function() {
    initUsage().then(
      () => console.log('[Better Claude / usage] init done, active:', usageActive),
      e  => console.error('[Better Claude / usage] init failed:', e)
    );
  }, window, { defineAs: 'initUsage' });
}
