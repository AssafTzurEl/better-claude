# Issue #5 — Usage bars: Design

> Surface Claude plan usage (5-hour session + weekly) as thin, always-visible
> bars injected into the claude.ai UI, refreshed around message activity, with a
> manual refresh control. On by default; future settings toggle.
>
> Issue: https://github.com/AssafTzurEl/better-claude/issues/5

This document captures **what** we're building and **why**. The step-by-step
build order lives in [PLAN.md](./PLAN.md).

---

## 1. Summary of decisions

| Topic | Decision |
|---|---|
| Data source | Direct call to the JSON API `GET /api/organizations/{orgId}/usage` (same-origin `fetch` from the content script — cookies ride along, no scraping, no new permissions) |
| Metrics shown | `session` (5-hour) and `weekly_all` (weekly) |
| Color meaning | **Severity**, taken from the API's `severity` field — not metric identity, not a threshold we compute |
| Layout | Two horizontal lanes side by side, constrained to the chat column width (~720px); `label + %` to the **left** of each bar |
| Placement | Inject into the chat header's empty band (wide window); drop below the chat title (narrow window) |
| Refresh control | A `↻` button next to the bars; relative "last updated" text shown only when wide |
| Refresh triggers | Page load · message send (Enter) · response complete · every 10s while Claude is generating · manual `↻` |
| Default state | On by default. A toggle comes later, when the extension gets a settings page. |
| Target release | `1.1.0` (additive minor bump over the current `1.0.x` RTL line; `2.0.0` reserved for the settings-page era) |
| Safety principle | **Never break the page.** If the API shape or the header DOM isn't what we expect, the feature goes dark silently. |

---

## 2. Data source

### 2.1 Endpoint

```
GET https://claude.ai/api/organizations/{orgId}/usage
```

- Same-origin with our content script (we already run on `https://claude.ai/*`),
  so a `fetch(url, { credentials: 'include' })` carries the session cookies
  automatically. **No new host permissions, no background worker required for v1.**
- Response `content-type: application/json`, ~1.4 KB.

### 2.2 Response shape (the parts we use)

Captured 2026-06-24 (Pro plan, low usage). Secrets removed.

```json
{
  "five_hour": { "utilization": 7.0, "resets_at": "2026-06-24T21:00:00.528862+00:00" },
  "seven_day": { "utilization": 48.0, "resets_at": "2026-06-26T01:00:00.528883+00:00" },
  "limits": [
    { "kind": "session",    "group": "session", "percent": 7,  "severity": "normal", "resets_at": "2026-06-24T21:00:00.528862+00:00", "scope": null, "is_active": false },
    { "kind": "weekly_all", "group": "weekly",  "percent": 48, "severity": "normal", "resets_at": "2026-06-26T01:00:00.528883+00:00", "scope": null, "is_active": true }
  ],
  "spend": { "percent": 0, "severity": "normal", "enabled": false, "...": "usage-credits, out of scope for v1" }
}
```

We drive the UI from the **`limits` array** (preferred — it carries `severity`
and `is_active`), keyed by `kind`:

| `kind` | Lane | Notes |
|---|---|---|
| `session` | 5-hour | `is_active:false` when no session is in progress |
| `weekly_all` | Weekly | `is_active:true` here = the currently binding limit |

`five_hour.utilization` / `seven_day.utilization` are the same numbers if we
ever need a fallback path, but `limits[]` is the source of truth because only it
has `severity`.

Other keys (`seven_day_opus`, `seven_day_sonnet`, `extra_usage`, `spend`, …) are
out of scope for v1.

### 2.3 Fields we read per limit

- `percent` (0–100) → bar fill width and the `%` label.
- `severity` → color (see §4).
- `resets_at` (ISO 8601 UTC) → the reset-time label, computed client-side.
- `is_active` → optional emphasis on the binding limit.

### 2.4 Verification items

1. ~~**Required headers.**~~ **RESOLVED (2026-06-24).** A same-origin
   `fetch('/api/organizations/{org}/usage', { credentials: 'include' })` with
   **no `anthropic-*` headers** returns `200` + JSON. Cookies alone are
   sufficient; do not send custom headers.
2. **`severity` enum.** Only `"normal"` observed so far. Capture a high-usage
   response (>80%) to learn the warning/critical values. Until then, map
   defensively: `normal → blue`, `warning → amber`, anything else → red.
3. **orgId discovery** — see §3.

---

## 3. Organization ID

The endpoint needs `{orgId}`. Sources, in order of preference:

1. **`lastActiveOrg` cookie** — **confirmed readable via `document.cookie`**
   (2026-06-24); not `HttpOnly`. This is the primary path:
   `document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1]`.
2. **A bootstrap/account endpoint** (e.g. `GET /api/organizations`) returning the
   user's orgs — pick the active one. Defensive fallback only, if the cookie is
   ever missing.
3. **URL / page state** as a last resort.

If no orgId can be resolved, the feature stays dark (safety principle).

---

## 4. Color = severity

Claude's own UI colors these bars by how close to the limit you are, **not** by
which metric they are. The API exposes this directly via `severity`, so we never
reverse-engineer thresholds.

Mapping (defensive until the full enum is confirmed):

| `severity` | Color intent | Token suggestion |
|---|---|---|
| `normal` | calm / plenty left | blue / accent |
| `warning` | getting close | amber |
| anything else (e.g. `critical`) | at/over limit | red |

Both lanes use the **same** severity scale; the two metrics are told apart by
their **left-side labels**, not by color. (This is why the labels are not
optional — two same-colored lanes are otherwise indistinguishable.)

Exact color tokens to match Claude's palette can be tuned later; matching the
*meaning* matters more than pixel-matching the hue.

---

## 5. Layout & placement

### 5.1 The bars

- Two lanes **side by side**, total width constrained to the **chat column
  width (~720px)**, not the full page (full width forces a long eye-scan).
- Each lane: `label + %` on the **left**, then a thin bar (~4px) with an
  always-visible gray track so an empty bar still shows its extent.
  - Example: `Session  7%  ▕█▁▁▁▁▁▁▁▁▁▏`   `Weekly  48%  ▕█████▁▁▁▁▁▏`
- Placing the label inline (left) rather than above keeps the row height to the
  text height (~18px) and is more compact than stacking.

### 5.2 Reset-time labels

Computed client-side from `resets_at`. Mirror Claude's phrasing:

- Session (near-term): relative — "Resets in 4 hr 20 min".
- Weekly (further out): absolute — "Resets Fri 4:00 AM" / "Resets Jun 26".

These can live in the hover detail rather than inline, to keep the bars thin.

### 5.3 Placement (responsive)

- **Wide window:** inject into the empty band in the chat header, between the
  chat title (left) and the page-icon / Share cluster (right). Reuses existing
  chrome — costs no extra vertical space.
- **Narrow window:** the header band collapses; render the bars on a line just
  below the chat title.

### 5.4 Refresh control & freshness

- A `↻` button sits next to the bars (Claude's own usage page has the same
  affordance). Click = manual refresh.
- A relative "last updated" label ("just now", "2 min ago", "19:43") shows
  **only when the window is wide enough**, claiming a little width for itself;
  hidden when narrow.

### 5.5 Hover detail (in v1 — required)

Hovering a lane reveals its reset time. A percentage without "resets when" is
only half the signal, and it matters *most* at 80–100% when the user is deciding
what to do now vs. defer until reset. So the reset time must be reachable in v1.

Minimum bar: a `title`/tooltip on each lane with its reset phrasing
(DESIGN §5.2). Preferred: a small hover card echoing Claude's dashboard popup —
per-metric label, exact `%`, reset time, and (when wide) last-updated + refresh.
Either satisfies v1; the inline bars stay thin and the reset detail lives on
hover.

---

## 6. Refresh triggers

| Trigger | Rationale |
|---|---|
| Page load | Bars aren't empty on first paint |
| Message send (Enter) | Usage changes when a prompt is submitted |
| Response complete | Capture the post-response number |
| Every 10s while generating | Keep the bar live during long generations |
| Manual `↻` | User-forced refresh |

Add a short **debounce / min-interval** so overlapping triggers (e.g. send +
10s poll) don't hammer the endpoint. Stop the 10s poll as soon as generation
ends.

---

## 7. Safety & robustness — "never break the page"

Two independent guards:

1. **Data guard.** Only render if the API call succeeds and the response parses
   into at least one recognized limit (`session` / `weekly_all`). On any failure
   (network, auth, shape change), render nothing and leave the page untouched.
2. **Injection guard.** Feature-detect the header anchor before inserting. If the
   expected structure isn't found, fall back to a minimal fixed-position strip,
   or skip entirely. Never throw into Claude's React tree.

Claude can change their DOM or API without notice; the acceptable failure mode is
"our feature quietly disappears," never "the page is broken."

---

## 8. Scope boundaries (v1)

**In:** session + weekly bars, severity colors, header injection with narrow
fallback, the listed refresh triggers, manual refresh, on-by-default.

Reset times are **in** v1 (reachable on hover; see §5.5).

**Out (future):** usage-credits / spend, per-model weekly breakdowns
(`seven_day_opus`/`sonnet`), context-window ring (per-chat, different source),
extension settings page + toggle.

---

## 9. Security note (process, not a feature)

The HAR captured during design contained a live `sessionKey` bearer token and
Cloudflare/Intercom session cookies. When capturing network data for this
project, share **only the response JSON body**, never a full HAR, and rotate
sessions if a token is ever exposed. The `/usage` response body itself carries
no secrets.
