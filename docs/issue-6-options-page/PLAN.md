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

**Threshold control: labeled slider**, "Prefer RTL ←→ Prefer LTR", with the raw
value shown small underneath. The audience is broader than developers; a bare
`1.2` ratio means nothing to most of them.

### Settings table

| Storage key | Type | Default | Range / values | Consumer |
|---|---|---|---|---|
| `ltrRatioThreshold` | number | `1.2` | 0.5–3.0, step 0.1 | `rtl.js` |
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

**Done when:** on claude.ai, `bcSettingsReady.then(() => console.log(bcSettings))`
logs the defaults; hand-writing a value via `browser.storage.sync.set` in the
extension console and reloading shows the new value; corrupt values fall back to
defaults without throwing.

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
  - Open sub-question for whoever builds this: after a message is sent the
    composer clears — decide whether the default re-asserts itself then, or the
    user's last manual direction sticks for the session. Sticking is friendlier;
    confirm against real usage.

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

---

## Quick reference

- **Storage:** `browser.storage.sync`, flat keys, validated on read
- **New files:** `settings.js` (content script, first), `options.html`, `options.js`
- **Manifest additions:** `permissions: ["storage"]`, `options_ui`
- **Shared global scope** across content scripts — prefix new globals `bc`/`BC_`
- **Guiding rule (inherited from issue #5):** never break the page — fail to
  defaults, not to a broken chat.
