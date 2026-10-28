# Global search (topbar) — FR-AUD-01

## What
The topbar search pill opens (Airbnb-style, one surface) into a panel: a full-width search field on top, then quick actions,
recent searches and popular searches; typing shows results grouped by type with counts and match highlighting. The sliders
button opens filters (date range with presets, department, type, owner, status).

## Files
- `features/search/actions.ts` (`"use server"`): `searchIndex()` reads the session and returns the role-filtered index + config.
  Called lazily from the client (first open, or ~1.2s after mount to warm it) and cached in a module promise for the session.
  The index is **never** in a page's RSC payload (it used to be; that leaked other modules' text into pages and broke `npm run smoke`).
- `features/search/api.ts` (server only): `getSearchData(role)` reads tasks, reports, attention items, payroll issues, orders, staff,
  candidates, client files and employee documents straight from `public/data/*` via `lib/data.ts` (features never import each other).
- `features/search/build.ts`: `buildIndex(raw)` → `SearchItem { id, type, title, ref, href, dept, owner, status, date }`;
  `filterIndexForRole` (module read access via `moduleForHref(href)`; staff-home roles only see their own tasks/reports),
  `filterActionsForRole` (`write: true` needs write access), `filterPopularForRole` (each popular term is tagged with a module).
- `features/search/match.ts`: scoring/ranking, filters, grouping, highlight segments, filter chips.
- `features/search/recents.ts`: recents (`localStorage` key `od-search-recents`, max 6, every access in try/catch).
- `features/search/shortcuts.ts`: pure keyboard matchers. `features/search/containment.ts`: outside-press helper.
- `features/search/components/global-search.tsx` (combobox + morphing surface), `filters-form.tsx` (`Field` + shadcn `Select` +
  date-range popover built from `Popover` + `Calendar`, `.od-pop` / `.od-menu` skins).
- Mock config: `public/data/search/popular.json` (`{ term, module }`), `public/data/search/actions.json` (`{ id, label, href, icon, write? }`).
- Styles: `app/styles/search.css` (imported in `app/(app)/layout.tsx`).
- Wiring: `app/(app)/layout.tsx` passes `<GlobalSearch departments today />` into `AppShell`'s `search` slot (like `assistant`).
  Departments come from `navigation.departments` (tenant data); date presets count from `org.today`. Without the slot
  (platform console) the plain field renders. The Messages button in the topbar is a `next/link` to `/whatsapp` ("WhatsApp inbox").

## Look (ui-rules 1–10)
- Closed: exactly `.search` (flex 1 1 200px, max-width 280px, `--card`, `--r-pill`, 10px 14px, 13px, `--ink-3`) + ⌘K/Ctrl K hint
  (hidden ≤640px and while typing) + sliders button with a count badge.
- Open: one `--card` surface, `--r-lg`, `--shadow` (on a sibling layer), no border or ring anywhere (`outline:none`; the caret shows focus).
  The top row is the same row as the pill; its full-width field fill (`--mute-bg`, `--r-pill`, like `.od-filter-search`) is a `::before`
  that fades in, so the row's box never moves.
- Spacing: one gutter. The panel's inset is 8px (as in `.od-menu`) and each item's inset is 10px, so the field fill (8px), headings,
  rows, chips and filters all start their content 18px from the edge. The pill row is 14px when closed; its contents slide 4px
  in with a transform when it opens, so there is no layout change. Section headings are 11.5px/700 `--ink-3`.
- Rows use `.od-menu` item padding and radius (8px 10px, `--r-pill`, 13px/600). The active row (keyboard or pointer, one shared
  index) changes **text and icon colour only** (`--brand-deep`, or `--brand-3` in dark), per ui-rules 10. There is no fill and
  no sliding pill. Icons are `--ink-3` and turn `--brand`, with no icon chips. Rows never change geometry. Popular chips use
  `--mute-bg`; the active chip gets `--brand-soft`.
- Panel width: from the pill's left edge, `min(640px, viewport − 12px)`, at least the pill; at ≤640px the pill is full width and the
  panel only grows downward. The department segment can be covered while open (expected with this expansion).

## Keyboard
| Key | Action |
|---|---|
| ⌘K (mac) / Ctrl+K | focus + open; again while open closes and returns focus |
| `/` | same, only when focus is not in an input/textarea/select/contenteditable |
| ↑ / ↓ (Home/End in the list) | move through quick actions, recents, popular chips and results (one active index shared with the mouse) |
| Enter | open / fill the query; ⌘Enter / Ctrl+Enter opens a link in a new tab |
| Esc | clears the query first; second press closes (focus stays on the input or returns to where it was). In filters, Esc goes back to the list |
| Tab | input → clear → filter button → active option (roving tabindex); tabbing out of the area closes |
| Backspace (empty query) | removes the last active filter chip |
| Alt+F / ⌥F | opens filters (`code === "KeyF"`, since ⌥F types "ƒ" on mac) |

IME: keys are ignored while `isComposing`. The ⌘K hint uses `useSyncExternalStore` (server snapshot `null`, no hydration mismatch).
No kbd footer (no other popover has one).

## Outside press
A pointerdown outside the root and outside its own portalled popups closes the panel. Nested Select lists and the date-range popover
carry `data-od-search-layer`; `isInsideSearch(target, root)` checks containment (never a global "disable dismissal").

## Motion (ui-rules → Motion)
- One surface, **clip-path only** (rule 15: no width/height animation). The root stays in the topbar flow as a same-size placeholder;
  `.od-search-layer` is absolutely anchored at its top-left and laid out at the final panel width at once. A single spring
  (stiffness 320, damping 36, mass 0.9: no overshoot) drives a 0→1 progress; each frame the surface's clip is
  `inset(0 R B 0 round r)` from the pill's rect + radius to `inset(0 round --r-lg)`, then the clip is removed (identical frame).
  Interruptible: reopening mid-close continues from the current progress.
- Choreography: sections fade + rise 4px starting at `--dur/2` (≈40% of the expansion), suggestion sections stagger 30ms; the shadow
  layer fades in alongside. Close: sections fade first (`--dur-fast`), the clip springs back to the pill, then the layer returns to pill
  width (visually identical). Verified frame by frame: input position never changes; first/last frames equal the pill.
- Blink diagnosis (for the record): an earlier version animated width/height and snapped `height` to `auto` at the end. The measured
  target was taken while the field's CSS margin/height transition was still running, so the last frame jumped ~13px. A clip-path
  version then left motion's committed `clip-path` on the element after close. Both are gone: no size animation, the clip is written
  per frame from one progress value, and removed at the ends.
- Results/groups/recents/filter chips: `AnimatePresence initial={false} mode="popLayout"`, keyed by id, `layout="position"` only
  (no scale). Group counts roll with `RollNumber`. Filter badge pops (CSS keyframe re-keyed on change). Popular chips lift 1px on hover.
- Reduced motion: no clip/stagger (global CSS rule + `MotionConfig reducedMotion="user"`); open/close are instant.

## Known gaps
- Only `/tasks` reads `?q=`; other modules get `?q=<ref>` in the href but don't deep-link yet. "New task" uses `/tasks?new=1`, which
  TasksView doesn't open yet.
- The highlighted item in shared `.od-menu` Select lists is unreadable in dark mode with a non-default tenant brand (shared skin, not this feature).
