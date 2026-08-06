# Issue #6 — Settings/options page: Design & implementation plan

Step-by-step build order, sized so each step can be done in its own session.
Each lists its goal, the work, and a concrete "done when" check.

**Context for a cold session:** Manifest V3 Firefox extension, content-script
only — no popup, no background worker. `rtl.js` (RTL alignment, renamed from
`content.js` in `cf19f9d`) and `usage.js` (usage bars) are both registered in
`manifest.json` under one `content_scripts` entry. They run in the same isolated
world and therefore **share a global scope**: a top-level `const` in one file is
visible in the other, and a duplicate name is a redeclaration `SyntaxError`.
The existing code already respects this (`log` vs `usageLog`). This feature adds
a third content script plus the extension's first non-content-script page.

---

## Design decisions

**Storage: `browser.storage.sync`.** The extension declares an explicit
`browser_specific_settings.gecko.id`, which is what Firefox requires for `sync`.
Without a Firefox Account the data simply stays local, so `sync` is never worse
than `local`. Four scalars is far inside the 100KB / 8KB-per-item quota. Wrap
reads in `try/catch` → fall back to defaults, so a sync-disabled build degrades
instead of throwing.

**Shared module: `settings.js`, listed first** in the `content_scripts.js`
array. It owns the defaults table, the storage read, and the change
subscription. `rtl.js` and `usage.js` consume it rather than each defining its
own constants. Prefix every global it introduces with `bc` / `BC_` to avoid
redeclaration collisions in the shared scope.

**Page language: English only.** Keep every user-facing string in one object at
the top of `options.js` so `browser.i18n` can be layered on later without
restructuring the page.

**Threshold control: labeled slider**, "Prefer RTL ←→ Prefer LTR". The audience
is broader than developers; a bare `1.2` means nothing to most of them, so the
slider is labeled as a **ratio that updates as it moves** — "Switches to
left-to-right at a Latin : Hebrew/Arabic letter ratio of **1.2 : 1**". Say
"Latin", not "English": the LTR regex covers Latin-1 supplement, so French,
Spanish and German count too.

**The scale is geometric, and the slider steps in display space.** A ratio's
natural centre is `1.0` and its mirror of `0.5` is `2.0`, not `1.5` — so a
linear `0.5–2.0` slider would put balance at a third of the track, give the RTL
half a third of the tuning resolution, and make a notch worth 20% at one end and
5% at the other.

**Instead the 0.1 increments are applied to the displayed ratio, and the
threshold is derived from that** — not the other way round. Slider position `p`
runs `-10 .. +10` in whole steps; the displayed ratio component is
`r = 1 + |p| / 10` (so `r` walks 1.0, 1.1, 1.2 … 2.0 by exactly 0.1); the stored
threshold is `r` on the LTR side and its reciprocal `1 / r` on the RTL side.
That is what makes the two halves mirror images: `p = -4` stores `1 / 1.4`,
`p = +4` stores `1.4`, and the two multiply to 1.

All 21 stops:

| p | Label | Stored `t` | | p | Label | Stored `t` |
|---:|---|---|---|---:|---|---|
| -10 | 1 : 2 | 0.500 | | +1 | 1.1 : 1 | 1.100 |
| -9 | 1 : 1.9 | 0.526 | | +2 | **1.2 : 1** | **1.200** ← default |
| -8 | 1 : 1.8 | 0.556 | | +3 | 1.3 : 1 | 1.300 |
| -7 | 1 : 1.7 | 0.588 | | +4 | 1.4 : 1 | 1.400 |
| -6 | 1 : 1.6 | 0.625 | | +5 | 1.5 : 1 | 1.500 |
| -5 | 1 : 1.5 | 0.667 | | +6 | 1.6 : 1 | 1.600 |
| -4 | 1 : 1.4 | 0.714 | | +7 | 1.7 : 1 | 1.700 |
| -3 | 1 : 1.3 | 0.769 | | +8 | 1.8 : 1 | 1.800 |
| -2 | 1 : 1.2 | 0.833 | | +9 | 1.9 : 1 | 1.900 |
| -1 | 1 : 1.1 | 0.909 | | +10 | 2 : 1 | 2.000 |
| 0 | 1 : 1 | 1.000 | | | | |

The table is generated, not hand-maintained — these two helpers live in
`options.js` and are the authoritative definition:

```js
// Slider position -> stored threshold. p >= 0: 1 + p/10. p < 0: its reciprocal.
const bcPosToRatio = p =>
  p >= 0 ? 1 + p / 10 : Math.round(1000 / (1 - p / 10)) / 1000;

// Stored threshold -> nearest slider position (may be off-stop; see below).
const bcRatioToPos = t => Math.round((t >= 1 ? t - 1 : 1 - 1 / t) * 10);
```

The `1000`/`3`-decimal rounding is not cosmetic: `1 / 1.2 = 0.8333…` and one
decimal would collapse it to `0.8`, a different stop. `BC_LTR_RATIO_DECIMALS`
in [settings.js](../../settings.js) is 3 for the same reason, and all 21 stops
round-trip `p → t → validated → p` unchanged.

21 stops, 0.1 granularity in the units the user sees, symmetric, every notch
worth the same, and today's default lands exactly on `p = +2`.

**Storage holds `t`, never `p`.** `p` is a presentation coordinate local to
`options.js` (`bcRatioToPos` / `bcPosToRatio`). Storing the ratio keeps
`rtl.js` free of any translation layer, keeps the saved value self-describing,
and means a future build can change the stop table or the default without
silently reinterpreting everyone's existing preference. A stored value that
falls between stops keeps working: the thumb snaps to the nearest stop, but the
**label reads from the stored `t`** — a hand-edited `2.5` shows "2.5 : 1"
rather than quietly claiming the user is on `2.0` — and only re-syncs once the
slider is actually moved.

### Settings table

| Storage key | Type | Default | Range / values | Consumer |
|---|---|---|---|---|
| `ltrRatioThreshold` | number | `1.2` | slider 0.5–2.0 (21 stops); accepted 1/3–3.0 | `rtl.js` |
| `defaultInputDirection` | string | `'ltr'` | `'ltr'` \| `'rtl'` | `rtl.js` |
| `debugLogging` | boolean | `false` | — | both |
| `usageBarsEnabled` | boolean | `true` | — | `usage.js` |
| `schemaVersion` | number | `1` | — | migrations |

Clamp and type-check on **read**, not only on write — storage can hold values
from an older version or a hand-edited profile.

---

## Step 0 — `settings.js` scaffolding

**Goal:** settings load from storage and are readable by the other scripts. No
UI, no behavior change.

- New `settings.js`, first in the `content_scripts.js` array in `manifest.json`.
- Add `"permissions": ["storage"]` — the extension's first permission. `storage`
  is non-prompting in Firefox, so the install experience is unchanged. Leave
  `data_collection_permissions` at `none`: storing a user's own preferences is
  not data collection.
- Export the defaults table, a mutable `bcSettings` object seeded with defaults,
  and `bcSettingsReady` — a promise that resolves once storage has been read.
  **Mutate `bcSettings` in place** on update rather than rebinding, so consumers
  holding a reference always see current values.
- Validation helper that clamps/coerces each key against the table.

**Testing this is not obvious.** Content-script globals live in an isolated
sandbox — the page console (F12) cannot see `bcSettings`, and `about:debugging`
→ Inspect opens the *extension's* context, which for this extension has no JS
at all (no background script), so `browser` is undefined there too. Until the
options page exists there is no privileged context. Hence
`BC_SETTINGS_DEV_EXPORTS` in `settings.js`: set it to `true`, let `web-ext`
reload, and the page console gains `bcDumpSettings()`, `bcSetSettings(json)`
and `bcClearSettings()`. Set it back to `false` before committing — and delete
the block once Step 1 makes it redundant.

**Done when:** with dev exports on, `bcDumpSettings()` logs the defaults;
`bcSetSettings('{"ltrRatioThreshold":2.4,"debugLogging":true}')` + reload shows
the new values; `bcSetSettings('{"ltrRatioThreshold":"banana"}')` + reload falls
back to `1.2` without throwing; with dev exports and `debugLogging` off, the
console is silent.

---

## Step 1 — The options page

**Goal:** a working settings UI that persists all four values. Consumers don't
read them yet.

- `options.html` + `options.js` (+ inline `<style>` or `options.css`).
- Manifest:
  ```json
  "options_ui": { "page": "options.html", "open_in_tab": false }
  ```
  Embedded in `about:addons` is the Firefox-native placement; no reason to open
  in a tab for four settings.
- Controls: slider (threshold), radio pair (default input direction), two
  checkboxes (debug logging, usage bars).
- The threshold slider is `min="-10" max="10" step="1"` over the position `p`,
  with `bcRatioToPos` / `bcPosToRatio` converting to and from the stored ratio —
  see the geometric-scale decision above. The stop table lives here, not in
  `settings.js`: it is presentation.
- Load current values on open; write on change (no Save button — instant-apply
  is the WebExtension norm). Show a brief "Saved" acknowledgement.
- Add a "Restore defaults" button.
- Style for **both** color schemes via `prefers-color-scheme`; `about:addons`
  follows the browser theme and an unstyled page looks broken in dark mode.

**Done when:** the page renders in `about:addons`, every control round-trips
through storage (change → reopen page → value persists), and "Restore defaults"
resets all four.

---

## Step 2 — Wire `rtl.js` to settings

**Goal:** three of the four settings actually do something.

- Replace the `LTR_RATIO_THRESHOLD` and `DEBUG` constants
  ([rtl.js:8](../../rtl.js#L8), [rtl.js:10](../../rtl.js#L10)) with reads from
  `bcSettings`. Read at **call time** inside `log()` and
  `detectDirectionFromText()`, not captured at load, so live changes take effect.
- **Gate init on `bcSettingsReady`.** `rtl.js` currently runs
  `injectInputStyles()` / `applyDirectionToChat()` / `attachInputHandler()` at
  top level ([rtl.js:195-199](../../rtl.js#L195)). Wrap that block in
  `bcSettingsReady.then(...)`. The `MutationObserver` may stay at top level —
  it only schedules a debounced update.
- **Default input direction — new behavior.** `rtl.js` never sets an initial
  input direction today; it only responds to Ctrl+Shift. In
  `attachInputHandler()`, apply `bcSettings.defaultInputDirection` when
  attaching. Mark manual overrides on the element (e.g.
  `dataset.betterClaudeUserDir`) in `handleInputKeydown` and never re-apply the
  default over a user's explicit choice for that input.
  - ~~Open sub-question: after a message is sent the composer clears — decide
    whether the default re-asserts itself then, or the user's last manual
    direction sticks for the session.~~ **Resolved: it sticks.** A Ctrl+Shift
    press records the direction on the element (`betterClaudeUserDir`, so that
    element is never touched again) *and* in a tab-scoped `bcInputDirOverride`,
    which is what every composer mounted afterwards starts in. The setting is
    the starting point, not a correction that keeps coming back. Deliberately
    not tied to whether Claude recycles or replaces the composer node — that is
    their implementation detail, and the behavior should not follow it.

**Done when:** moving the slider and reloading visibly changes which mixed
paragraphs render RTL; debug logging off produces zero `[Better Claude]` console
output; a fresh chat's input box starts in the configured direction, and
Ctrl+Shift still wins over it.

---

## Step 3 — Wire `usage.js` to settings

**Goal:** the usage-bar toggle works, and shipped builds stop logging.

- Replace `USAGE_ENABLED` / `USAGE_DEBUG` ([usage.js:7-8](../../usage.js#L7))
  with `bcSettings` reads; gate `initUsage()` on `bcSettingsReady`.
- **`USAGE_DEBUG` is currently `true` in shipped code, and it gates two separate
  things.** Split them:
  - Console logging → the user-facing `debugLogging` setting.
  - The `exportFunction` block ([usage.js:761](../../usage.js#L761)), which
    publishes `fetchUsage` and `remountUsageWidget` onto the **page's** `window`
    → a separate dev-only constant, left `false` in shipped code. A user
    checkbox should not add API surface to claude.ai.
- **Turning the feature off needs real teardown, not just a flag.** `USAGE_ENABLED`
  is only checked inside `initUsage()` ([usage.js:751](../../usage.js#L751)),
  while the placement observer and the SPA-navigation observer
  ([usage.js:746](../../usage.js#L746)) are registered unconditionally at top
  level and will happily re-mount the widget. Add a `teardownUsage()` that
  removes the widget node, clears `refreshTimer` / `pollTimer`, and makes the
  observers no-op while disabled — and an `initUsage()` path that can start the
  feature mid-session without a page reload.

**Done when:** unchecking "usage bars" makes them disappear within a second and
they stay gone across chat switches and window resizes; re-checking brings them
back without a reload; with debug logging off, claude.ai's console is clean and
`window.fetchUsage` is `undefined`.

> ~~**What actually fires `teardownUsage()` is Step 4.** Nothing in the tab is
> listening to storage yet, so at the end of Step 3 the toggle is verified by
> reloading claude.ai after changing it, and the mid-session start/stop path by
> calling `teardownUsage()` / `initUsage()` from the page console with
> `USAGE_DEV_EXPORTS` flipped on.~~ **Done in Step 4:** the checkbox now drives
> `initUsage()` / `teardownUsage()` directly and the reload is no longer needed.

---

## Step 4 — Live updates

**Goal:** changing a setting takes effect in open tabs without a reload.

- In `settings.js`, subscribe to `browser.storage.onChanged` (area `sync`),
  validate the incoming values, mutate `bcSettings` in place, then notify
  registered listeners.
- Provide `bcOnSettingsChanged(fn)` so each consumer registers its own reaction
  rather than `settings.js` reaching into their internals:
  - threshold → re-run `applyDirectionToChat()`. Safe to re-run: it recomputes
    and overwrites inline styles in both directions, so it self-corrects.
  - `usageBarsEnabled` → `initUsage()` / `teardownUsage()`.
  - `debugLogging` → nothing; both log helpers read at call time.
  - `defaultInputDirection` → applies at next input mount, per Step 2.

**Notify on a diff, not on the event.** `bcApplyAndDiff()` validates the
incoming values, applies them, and returns the Set of keys whose value actually
changed; listeners are called with that Set and skipped entirely when it is
empty. Three things fall out of it. The options page writes its own change to
`bcSettings` *before* the storage round trip (Step 1), so its own echo diffs to
nothing — no feedback loop, and no consumer redoing work it already did. A
clamped or coerced value that lands on the value already held (`"banana"` →
`1.2` when the threshold is already `1.2`) is likewise a non-event. And a
consumer can cheaply ignore keys that are not its business.

**The event is an overlay, not a snapshot.** `changes` carries only the keys
that were written, so the handler starts from what it holds and overlays those.
A key that was *removed* arrives with no `newValue`, and `undefined` is exactly
what makes `bcValidateSettings` fall back to the default — the right answer,
rather than keeping the stale value we happen to still be holding.

**Handling is held behind `bcSettingsReady`.** An event arriving while the
opening `get()` is still in flight would otherwise be overwritten by that older
snapshot the moment it resolves.

**A throwing listener is contained** — `try/catch` per listener, so one broken
consumer costs neither the others their update nor the page its stability.

**The options page is a consumer too.** It loads `settings.js`, so it gets the
same subscription; it re-renders its controls on a genuine external change (a
value synced in from another device, or a second copy of the page) instead of
sitting there showing something that is no longer true.

**Done when:** with claude.ai open in two tabs, changing a setting updates both
within a second, with no reload and no console errors.

---

## Step 5 — Hardening & release

**Goal:** safe to ship.

- Verify the failure paths: storage unavailable → defaults, page fine; garbage
  values in storage → clamped, page fine; options page opened with no prior
  saved settings → shows defaults.
- Check RTL and usage still coexist — no shared-global collisions from the new
  `bc*` names, no double observers.
- Test light and dark, and on an RTL page.
- Bump `manifest.json` to `1.2.0`; update the `description` if the settings page
  is worth mentioning.
- `README.md`: move "Configurable settings page" out of **Planned features**
  into the current-features list, in **both** the English and Hebrew sections,
  and update the "How it works" paragraph (it currently says "two content
  scripts").

**Done when:** manual test passes on a normal account, every setting round-trips
and takes effect, and both guard failures degrade silently.

### What the failure paths actually do

Checked by running `settings.js` and `options.js` against a stubbed `browser`
and DOM, rather than by reading them:

- **No prior saved settings** → every key its default.
- **Garbage in storage** (`"banana"`, `"up"`, `"yes"`, `0`, `2.9`) → each key
  falls back or coerces on its own; unknown keys are ignored; nothing throws.
  `schemaVersion: 2.9` floors to `2`, so a migration keyed on 3 is not skipped.
- **Out of range** → `99` → `3.0`, `0.001` and `-5` → `0.333`.
- **`storage.sync.get` throws** → warning, defaults, and `bcSettingsReady` still
  resolves — which is what keeps `rtl.js` and `usage.js` starting at all.
- **`storage.onChanged` unavailable** → warning, and the initial read is
  unaffected.
- **Change events** → overlay (untouched keys survive), diff (a write landing on
  the held value notifies nobody), removal (no `newValue` → default), and area
  (`local` ignored).
- **A listener that throws** → contained; the next listener still runs.
- **`storage.sync.set` throws** → the error message is shown, and the page keeps
  the value locally rather than silently reverting under the user.
- **A partial patch** → `bcSave` writes the merged whole, so changing one
  control cannot reset the other four.
- **All 21 slider stops** round-trip `p → t → validated → p`; mirrors multiply
  to 1; an off-stop `2.53` reads back as `2.53 : 1` while the thumb snaps.

**No collisions:** concatenating the three content scripts (and separately
`settings.js` + `options.js`) parses clean, which is the same lexical-redeclaration
check the shared global scope applies. No `bc*` name is declared twice, and the
three top-level observers in `usage.js` all gate on `usageActive`.

**Two fixes came out of it:**

- `usage.js` — the initial `initUsage()` had no `.catch()`, unlike its sibling
  on the settings-change path. A first mount that threw would have surfaced as
  an unhandled rejection in claude.ai's console.
- `options.js` — `dir` is now set beside `lang`. The page is embedded in
  `about:addons`, and an English-only page should not inherit its layout
  direction from the browser locale.

**Release:** `manifest.json` → `1.2.0`, description now mentions the settings.
`README.md` — settings page moved into the current-feature list in both
languages, "two content scripts" → three plus a paragraph on what the settings
script does, and the stale English "RTL support in the input textbox" planned
item replaced with the per-paragraph one the Hebrew list already had. The
privacy section now says what is stored: four settings in extension storage,
synced by Firefox to the user's own devices if they have an account, and never
to the author.

---

## Quick reference

- **Storage:** `browser.storage.sync`, flat keys, validated on read
- **New files:** `settings.js` (content script, first), `options.html`, `options.js`
- **Manifest additions:** `permissions: ["storage"]`, `options_ui`
- **Shared global scope** across content scripts — prefix new globals `bc`/`BC_`
- **Threshold:** storage holds the ratio `t`; the slider's `p` (`-10..+10`, 0.1
  per step in the *displayed* ratio) exists only in `options.js` — see
  [Threshold control](#design-decisions) for the stop table and helpers
- **Guiding rule (inherited from issue #5):** never break the page — fail to
  defaults, not to a broken chat.
