// Better Claude - Usage bars module
// Fetches and parses Claude plan usage (session + weekly) from the API,
// and renders them as thin bars in a temporary fixed-position strip (Steps 0–2).

// === Configuration ===
const USAGE_ENABLED = true;
const USAGE_DEBUG = true;

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
  if (severity === 'normal')  return '#3b82f6'; // blue
  if (severity === 'warning') return '#f59e0b'; // amber
  return '#ef4444';                              // red (critical or unknown)
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
    #bc-usage-widget {
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

// Read the actual rendered background of the page (body or html), skipping transparent layers.
function getPageBackground() {
  for (const el of [document.body, document.documentElement]) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  }
  return null;
}

function mountUsageWidget(usageData) {
  document.getElementById('bc-usage-widget')?.remove();
  if (!usageData) return;

  injectUsageStyles();

  const widget = document.createElement('div');
  widget.id = 'bc-usage-widget';
  widget.appendChild(buildUsageLane('Session', usageData.session, formatSessionReset));
  widget.appendChild(buildUsageLane('Weekly',  usageData.weekly,  formatWeeklyReset));

  const bg = getPageBackground();
  if (bg) widget.style.background = bg;

  // Insert into #main-content (position: relative) so the widget's
  // CSS left:50%/translateX(-50%) centers over the content column, not the
  // full viewport — and stays correct at any zoom level without JS measurement.
  const mainEl = document.getElementById('main-content');
  if (mainEl) {
    mainEl.appendChild(widget);
  } else {
    // Fallback: switch to fixed positioning and append to body.
    widget.style.position = 'fixed';
    document.body.appendChild(widget);
  }

  usageLog('widget mounted');
}

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
