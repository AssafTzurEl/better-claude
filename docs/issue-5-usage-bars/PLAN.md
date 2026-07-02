# Issue #5 — Usage bars: Implementation plan

Step-by-step build order for the feature designed in [DESIGN.md](./DESIGN.md).
Steps are sized so each can be done in its own session (new chat/agent). Each
lists its goal, the work, and a concrete "done when" check.

**Context for a cold session:** This is a Manifest V3 Firefox extension. Today it
is content-script only — `content.js` runs on `https://claude.ai/*` (registered
in `manifest.json`) and does RTL alignment. There is no popup and no background
worker. This feature adds a usage-bar module to the same content-script world.
Keep it isolated from the RTL code (separate file/section) so the two features
don't entangle.

---

## Step 0 — Scaffolding & feature flag

**Goal:** a place for the code that's wired in but does nothing visible yet.

- Add a `usage/` module (e.g. `usage.js`) loaded by the content script, or a
  clearly separated section in `content.js`. Prefer a separate file added to the
  `content_scripts.js` array in `manifest.json`.
- Add a top-level `const ENABLED = true` flag (the future settings toggle hooks
  here) and a `DEBUG` log helper mirroring the existing one in `content.js`.

**Done when:** extension still loads, RTL still works, a debug log line from the
new module appears on claude.ai.

---

## Step 1 — Data layer: fetch + parse (no UI)

**Goal:** reliably get `{ session, weekly }` usage objects in the console.

1. **Resolve orgId** (DESIGN §3): read the `lastActiveOrg` cookie
   (`document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1]` — confirmed readable).
   Fallback to `GET /api/organizations` only if the cookie is missing. Cache it.
2. **Fetch** `GET /api/organizations/{orgId}/usage` with
   `fetch(url, { credentials: 'include' })`.
   - **No custom headers needed** — confirmed 2026-06-24 that cookies alone
     return `200` + JSON (DESIGN §2.4). Do not send `anthropic-*` headers.
3. **Parse** the `limits` array into:
   ```
   { session: { percent, severity, resetsAt, isActive },
     weekly:  { percent, severity, resetsAt, isActive } }
   ```
   keyed by `kind` (`session`, `weekly_all`). Tolerate missing entries.
4. **Data guard:** return `null` on any failure or if neither limit is present.

**Done when:** calling the fetch function on claude.ai logs correct percentages
and reset times; killing the network makes it return `null` (no throw).

---

## Step 2 — Render the bars (static, fixed position)

**Goal:** the visual from the design, fed by real data, in a temporary location.

- Build the DOM for two lanes: left `label + %`, thin bar with gray track + fill.
- Width constrained to ~720px; render side by side.
- Map `severity → color` (DESIGN §4): normal=blue, warning=amber, else=red.
- Reset-time formatting from `resetsAt` (DESIGN §5.2): relative for session,
  absolute for weekly. **Required in v1** — reachable on hover (DESIGN §5.5).
  Start with a `title`/tooltip per lane; upgrade to a small hover card if time
  allows.
- For now mount at a temporary fixed position (e.g. top strip) — placement comes
  next. Keep all styling scoped (unique class prefix, e.g. `bc-usage-`) so it
  can't leak into Claude's styles.

**Done when:** real session/weekly bars render on the page with correct widths,
colors, and labels, and hovering a lane shows its reset time.

---

## Step 3 — Placement & responsive behavior

**Goal:** bars live in the header (wide) / below the title (narrow), per design.

- **Injection guard** (DESIGN §7): feature-detect the header anchor. If found,
  insert into the empty band between title and the Share cluster. If not found,
  fall back to the Step-2 fixed strip (don't disappear during development; for
  release, decide whether fallback is a thin strip or nothing).
- Add the responsive rule: below a width breakpoint, move the bars below the
  title and hide the "last updated" text.
- Re-evaluate placement on resize and on SPA navigation (Claude is a single-page
  app — the header re-renders on chat switches; use a `MutationObserver` like the
  RTL code already does, or re-mount on route change).

**Done when:** resizing the window moves the bars correctly; switching chats
keeps them present; removing/altering the header anchor makes them fall back
without errors.

---

## Step 4 — Refresh control & triggers

**Goal:** the bars stay current and can be manually refreshed.

- Add the `↻` button next to the bars → manual refresh.
- Add the relative "last updated" label (show only when wide).
- Wire the triggers (DESIGN §6):
  - **Page load** — fetch once on mount.
  - **Message send (Enter)** — detect prompt submission (composer Enter / send
    button click).
  - **Response complete** — detect end of generation.
  - **10s poll while generating** — start on generation begin, stop on end.
  - **Tab becomes visible** — `visibilitychange` event; catches up after switching away.
  - **Manual `↻`**.
- Add a **debounce / min-interval** so stacked triggers don't hammer the API;
  stop the poll promptly when generation ends.

**Done when:** sending a message and finishing a response update the bars; the
10s poll runs only during generation; manual `↻` works; rapid triggers collapse
into at most one request per interval.

---

## Step 5 — Hardening & polish

**Goal:** safe to ship.

- Confirm **both guards** (data + injection) fail silently end-to-end: break the
  API URL → bars vanish, page fine; break the anchor selector → fallback, page
  fine.
- Verify no console errors, no layout shift, no style bleed (light & dark mode,
  RTL pages — this extension's core audience).
- Confirm coexistence with the RTL feature (no shared global state, no double
  observers fighting).
- Capture a **high-usage `severity`** sample if possible and finalize the color
  map (DESIGN §2.4).
- Update `README.md` (feature list) and `manifest.json` `description` if needed.
  Note: no new permissions should be required — confirm the manifest is unchanged
  except for adding the new content script file.

**Done when:** manual test passes on a normal account, the feature degrades
gracefully under both guard failures, and RTL is unaffected.

---

## Step 6 — Future (not v1, tracked separately)

- Extension **settings page** + on/off **toggle** (wire to the `ENABLED` flag).
- Usage-credits / spend display.
- Per-model weekly breakdown (`seven_day_opus` / `seven_day_sonnet`).
- Context-window ring (per-chat, separate data source).
- Richer hover card (beyond the v1 reset-time tooltip): per-model breakdown,
  spend, etc.

---

## Quick reference

- **Endpoint:** `GET https://claude.ai/api/organizations/{orgId}/usage`
- **Key fields:** `limits[].kind` (`session` | `weekly_all`), `.percent`,
  `.severity`, `.resets_at`, `.is_active`
- **orgId:** `lastActiveOrg` cookie → `/api/organizations` fallback
- **No new permissions** (same-origin fetch from existing content script)
- **Guiding rule:** never break the page — fail dark.
