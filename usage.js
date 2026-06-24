// Better Claude - Usage bars module
// Fetches and parses Claude plan usage (session + weekly) from the API.
// No UI yet — data layer only (Steps 0–1).

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

if (USAGE_DEBUG) {
  exportFunction(function() {
    fetchUsage().then(
      r => console.log('[Better Claude / usage] fetchUsage() =>', r),
      e => console.error('[Better Claude / usage] fetchUsage() threw:', e)
    );
    // Returns undefined synchronously — no content-script Promise crosses the boundary.
  }, window, { defineAs: 'fetchUsage' });
}
