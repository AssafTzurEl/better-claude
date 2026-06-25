// Better Claude - Usage bars module
// Fetches and parses Claude plan usage (session + weekly) from the API,
// and renders them as thin bars in the chat header (wide) or below the
// chat title (narrow). Falls back to a fixed strip if the header is not found.

// === Configuration ===
const USAGE_ENABLED = true;
const USAGE_DEBUG = true;

// Minimum pixel width for the widget to be useful in the header.
// Two progress bars need label + percent + track — less than this is too cramped.
// This is a content constraint, not a viewport breakpoint.
const WIDGET_MIN_USEFUL_PX = 280;

// === Logging ===
function usageLog(...args) {
  if (USAGE_DEBUG) console.log('[Better Claude / usage]', ...args);
}

usageLog('module loaded');

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
  if (!USAGE_ENABLED) return null;

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
      color: CanvasText;
      flex-shrink: 0;
    }
    .bc-usage-pct {
      white-space: nowrap;
      color: GrayText;
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
  clearTimeout(placementCheckTimer);
  placementCheckTimer = setTimeout(checkPlacement, 150);
}).observe(document.documentElement);

// === SPA navigation guard ===
// Claude re-renders the header on chat switches, which removes our injected
// widget. Watch for the widget disappearing from the DOM and re-mount it.

let spaRemountTimer = null;

new MutationObserver(() => {
  if (document.getElementById('bc-usage-widget')) return; // still present
  if (!lastUsageData) return;

  clearTimeout(spaRemountTimer);
  spaRemountTimer = setTimeout(() => {
    spaRemountTimer = null;
    usageLog('widget removed by SPA navigation, re-mounting');
    mountUsageWidget(lastUsageData);
  }, 300);
}).observe(document.body, { childList: true, subtree: true });

// === Init ===

async function initUsage() {
  if (!USAGE_ENABLED) return;
  usageLog('init');
  const data = await fetchUsage();
  mountUsageWidget(data);
}

initUsage();

// === Debug exports (Firefox only) ===

if (USAGE_DEBUG) {
  exportFunction(function() {
    fetchUsage().then(
      r => console.log('[Better Claude / usage] fetchUsage() =>', r),
      e => console.error('[Better Claude / usage] fetchUsage() threw:', e)
    );
  }, window, { defineAs: 'fetchUsage' });

  exportFunction(function() {
    fetchUsage().then(
      data => { mountUsageWidget(data); console.log('[Better Claude / usage] remounted'); },
      e    => console.error('[Better Claude / usage] remount failed:', e)
    );
  }, window, { defineAs: 'remountUsageWidget' });
}
