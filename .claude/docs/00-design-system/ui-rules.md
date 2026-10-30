# UI rules (read before adding any page or component)

The source of truth is `task_light.html` / `task_dark.html`, ported to `app/opsdesk.css`.
Every new UI must look like it came from that file, not from shadcn defaults.

## Mistake to never repeat: shadcn defaults leaking into the OpsDesk theme

The NavUser dropdown was first built with stock shadcn classes (`bg-popover`, `ring-1 ring-foreground/10`,
`rounded-lg`, `focus:bg-accent`, `text-muted-foreground`). It rendered with a green focus ring, grey
accents, small radius and different spacing, so it clashed with the rest of the UI.

### Rules
1. shadcn/base-ui components (`components/ui/*`) give behavior only (open/close, keyboard, positioning).
   Their colors, radius, border, shadow and hover states must be re-skinned with OpsDesk tokens.
2. Use OpsDesk variables, never shadcn tokens, for anything visible:
   `--card`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--brand`, `--brand-soft`, `--brand-deep`,
   `--shadow`, `--r-md|lg|xl|pill`, and `--ok/--warn/--bad/--info(-bg)`.
   Avoid `bg-popover`, `bg-accent`, `text-muted-foreground`, `ring-*`, `text-foreground`.
3. Put the skin in a named class in `app/opsdesk.css` (example: `.od-menu`) and pass it via `className`.
   Because it sits later in the file it wins over the component defaults. Use `!important` only to
   kill the ring/outline.
4. No default focus ring on popups: the global `:focus-visible{outline:2px solid var(--brand)}` also hits
   popup containers, so set `outline:none` on them. Keep a visible highlight on items instead
   (`[data-highlighted]` background `--brand-soft`).
5. Popovers/menus: `--card` background, NO border (the whole UI is borderless; separation comes from
   background + `--shadow`), `--r-lg` radius like `.card`, pill (`--r-pill`) items 13px / 600,
   hover `--brand-soft` + `--brand-deep` text, icons `--ink-3` turning `--brand`. See `.od-menu`.
   Dark mode: the highlight is brand-independent (`--ink` lifted over `--card`, `--ink` text and icon) so it stays legible with any tenant brand colour.
   Placeholders use `--placeholder` (>= 4.5:1 on `--mute-bg` and `--card`, light and dark), never `--ink-3` or `text-muted-foreground`.
   `ConfirmDialog` takes `children` (extra content under the description) and `confirmDisabled` (type-to-confirm).
6. Must work in light and dark. Check both (`[data-theme="dark"]`), tokens already switch, so never
   hard-code hex colors unless the original HTML does. The default theme is **light** for everyone
   (`defaultTheme="light"` in `app/layout.tsx`), whatever the OS setting; dark only when the user toggles it.
7. Verify in the browser next to the existing topbar/cards before reporting done.

8. This UI is borderless and generously rounded: cards `--r-lg`, topbar `--r-xl`, controls `--r-pill`.
   Never add 1px borders or small radii (`rounded-md/lg`) to new surfaces. Copy the radius of the nearest
   existing surface.

9. Dark mode: `--brand-deep` is near-black in dark, so never use it as text on `--brand-soft` there;
   use `--brand-3`. Always hover-test menus in dark.

10. Hover colors must contrast with the surface *behind* the element too. `--mute-bg` ≈ `--panel`, so a
    hovered white control on the topbar looks transparent; use `--line` for a grey hover there.
    - **Full-width rows on a card** (accordion triggers, list rows that fill a card): hover changes the
      **text colour only** (`--brand-deep`, dark `--brand-3`), never a fill. A `--mute-bg` fill on a white card
      matches the page bg and the card seems to vanish.
    - **Generic `[data-slot=…]` rules in `kit.css` leak** (padding, margin, border-radius). When a feature uses
      a shadcn part with its own class, reset what it doesn't want (e.g. `.rf-secs .rf-sec{padding:0;margin:0}`)
      and check that the hover fill reaches the card edges.

10a. **Disabled / read-only states.**
    - Read-only data (a submitted report in review) must stay readable: override shadcn's
      `disabled:opacity-50` on inputs and on the picked option (`opacity:1`, `--ink` text). Fade only the
      options that weren't picked.
    - Every disabled control shows `cursor:not-allowed` (pill labels and their children too) and loses
      its hover.
    - Off/empty controls must be visible on `--card` in both themes: a switch's off track is
      `color-mix(--ink-3 45%)` plus a thumb shadow, not `--line`.

10c. **Ark UI parts (`components/ui/color-picker.tsx`).** Ark finds its parts by generated id, so never set `id` on a part
    (pass `ids={{ trigger: id }}` to `Root`); an own id left the popover unanchored at the top-left corner. Ark also writes inline
    `position:relative` on area backgrounds and slider tracks, so size them with `height:100%` / `flex:1`, not `position:absolute;inset`.
    Slider thumbs get only `top/left:%`; centre them with `transform:translate(-50%,-50%)` in CSS.

10d. **Tenant brand colour.** Never hard-code the brand green: use `--brand*` tokens (or a `var(--x, default)` fallback that `lib/brand.ts` overrides,
    as `.app-card` does with `--promo-*`). `brandCss(hex)` turns the tenant colour into all brand tokens for light and dark (color-mix) and emits
    nothing for the default `#1a8a3a`. `app/(app)/layout.tsx` writes it into `<style id="od-brand">`; the branding panel rewrites that tag
    for a live preview and restores the saved colour on unmount. Saving goes through `saveBranding` (per-tenant cookie, merged by `getSession`).
    Status colours (`--ok/--warn/--bad`) stay fixed.

10b. **Browser check covers states, not just layout.** Before reporting done, hover every interactive
    row/pill/button, open every accordion/dialog, view the read-only and disabled variants, and repeat
    in dark mode. Matching sizes is not enough.

11. Every page and data-driven component ships with a skeleton that matches it exactly (same classes, measured `lh`, same counts).
    Use `Sk` from `components/sk.tsx`. Do not use shadcn's `Skeleton`: its `bg-muted` and `animate-pulse` are not OpsDesk tokens.
    Full rules are in `../architecture.md` → Skeletons.

11b. **Pagination.** Every data table paginates: `paginate()` (`lib/paginate.ts`) after filtering and sorting, then `DataPagination`
    (`components/data-pagination.tsx`, skin `.od-pager` in `kit.css`) inside the table's card. Never roll your own pager and never use the
    shadcn outline/ghost look. Sizes are a constant per feature (Tasks 10, Report history 10, Dashboard team tasks 5). Any filter or
    department change resets to page 1 (Tasks also drops `?page=`). Pages in the URL use `href`, client state uses `onPageChange`.
    The skeleton renders a `PagerSkeleton` row when the seed count exceeds the page size, and its row count is `min(count, size)`.

## Motion
OpsDesk is a corporate ops tool, so motion is short, quiet and functional. It shows where things came from or went. It is never decoration.
No GSAP. CSS covers most cases. The `motion` library (`motion/react`) is used only for what CSS can't do.

12. **Tokens only.** CSS uses `--dur-fast` (.15s, hover/press), `--dur` (.22s, popups, list rows), `--dur-slow` (.32s, page enter, panels), `--ease` (ease-out) and `--ease-in-out`.
    JS uses the same values from `lib/motion.ts` (`DUR`, `EASE`, `listItem`, `layoutTransition`). Don't write new raw durations or springs.
13. **Pick the tool by job.**
    - **CSS:** hover, focus, open/close, page enter, skeleton → content.
    - **`motion`:** these four only:
      - A shared indicator that moves between items: `layoutId`. Two examples in `AppShell`:
        - the sidebar active bar, `<motion.span layoutId="nav-active" className="nav-ind">`
        - the department filter pill, `seg-active` / `.seg-ind`. On phones (≤640px) `DeptSeg` is hidden and `DeptRow`
          (`features/shell/components/dept-row.tsx`) takes over: a full-width, scroll-snapped pill row under the search,
          44px pills, no scrollbar, its own `dept-row-active` indicator, active pill centred on change.
      - A live counter whose value changes: `<RollNumber>` from `components/roll-number.tsx`. It is used for the countdown.
        - It rolls per digit, so only the digits that changed move.
        - Old and new digits share one grid cell, not `popLayout`, so there is no jitter.
        - Use `dir="down"` for decreasing counters.
      - Progress bars (`.progress i`) fill from 0 with the CSS `od-fill` keyframe (scaleX, so no layout cost). New bars get this for free.
20. **Scroll reveal: anything that animates once must not play off screen.**
    - A progress bar (or any "fill/count" animation) that starts outside the viewport waits at its start state, then plays when it is scrolled into view (once).
    - How it works:
      - `components/reveal-observer.tsx` is mounted once in `AppShell`. It marks elements matching its `REVEAL` selector with `[data-inview]` when they enter the viewport.
      - CSS holds the animation with `:root[data-reveal] <el>:not([data-inview])` (see `.progress` in `opsdesk.css`).
      - Elements already on screen at load are marked at once, so they don't replay.
      - New elements (route change, dialog) are picked up automatically.
      - Every REVEAL element needs `suppressHydrationWarning` (e.g. `<div suppressHydrationWarning className="progress">`). The observer
        runs from the shell, which can hydrate before a streamed page, so it may add `[data-inview]` first, which causes a hydration mismatch error.
      - Without JS or with reduced motion, nothing is held.
    - To add another element type, add its selector to `REVEAL` and write a matching hold rule in CSS. Don't write a per-component IntersectionObserver.
    - **JS-driven animations follow the same rule.** Use `useInView(ref, { once: true, margin: "0px 0px -10% 0px" })` from `motion/react`.
      - `CountUp` does this internally, so every count-up waits for view.
      - **Recharts:** mount the animated series only when `inView` (`{inView && <Bar…/>}` / `<Pie…/>`). Recharts animates on mount, so a chart below the fold would otherwise finish before anyone sees it.
        Done in `tasks-closed-chart.tsx` and `task-progress.tsx`. Also pass `isAnimationActive={!useReducedMotion()}`.
      - Every new chart or gauge must do the same.
      - Rows entering or leaving a filtered list: `AnimatePresence` + `listItem`.
      - Drag to reorder: `Reorder.Group/Item` + `.od-drag`.
      - **Kanban (drag between columns): `@dnd-kit`** (`core` + `sortable`), never `motion`. Pointer (distance 6), touch (delay 200) and keyboard sensors, `DragOverlay` lifted card, faded origin placeholder, target column highlighted, drop = the same mutation as the non-drag stage select (history + toast), only for `canWrite`, no drop animation under reduced motion. Multi-container pattern: a local draft of column ids moves the card into the hovered column during `onDragOver` (cards slide aside live), with a one-frame settle guard (else an update loop); `DragOverlay` portalled to `document.body` (an animated ancestor offsets a fixed overlay and skews collisions). The lifted card tilts with horizontal drag speed (`useVelocity` → clamped ±10° → `useSpring`), pivoting on the grab point, and springs upright when the pointer stops or drops (`Lifted`; a plain card under reduced motion). Reference: `features/recruitment/components/pipeline.tsx`.
      - **Tabs inside a page** (e.g. Settings): never a route navigation per tab. Render the panels up front, switch in place with `history.pushState`, `layoutId` sliding pill, CSS `od-enter` on the panel.
      - Numbers counting up: `<CountUp>` from `components/count-up.tsx`. It is used for the stat cards and the gauge percentage.
        The gauge passes `duration={1}` so the number keeps pace with the Recharts arcs.
14. **Page enter is automatic.** `.canvas>*` fades up 8px with a 40ms stagger, on first load, on route change and when `loading.tsx` hands over to the page.
    Don't add per-page enter animations. Skeleton pages (`.sk-page`, display:contents) don't animate.
15. **Animate only `opacity` and `transform`** (plus motion's `layout`). Never animate width, height, top or left, or colors on large surfaces.
    Use `AnimatePresence initial={false}` so lists don't replay on mount; the page enter already covers mount.
16. **Reduced motion is mandatory.**
    - CSS is covered by the global rule in `opsdesk.css`.
    - `motion` animations are covered by `<MotionConfig reducedMotion="user">`, which wraps the whole `AppShell`, sidebar included.
    - Any hand-driven JS animation must check `useReducedMotion()` itself (see `CountUp`).
17. **No layout shift.** `CountUp` server-renders the final value. Drag lift uses a spread shadow (`.od-drag[data-dragging]`), not padding.
    Skeleton sizes must not change.
18. Popups (`.od-menu`, `.ai-panel`, dialog) use `--dur` / `--dur-slow`, not shadcn's 100ms.
    **Mistake to avoid:** never change a popup's duration without also changing its overlay's, and the overlay needs `animation-fill-mode:both`.
    When the popup was slowed to 220ms and the overlay stayed at 100ms, the overlay finished first and snapped back to full opacity, so the whole page blinked on close.
    Also keep the popup's content rendered while it closes: keep the last value in state, as `day-details-dialog.tsx` does, so it doesn't empty mid-fade.
19. View Transitions are used for the theme toggle's circular reveal (`nav-user.tsx`) and for the task row → detail morph:
    `morphToRecord()` (`features/tasks/record-transition.ts`) names only the two elements for that one transition, holds the old frame at most 600ms
    and scopes its CSS to `:root[data-vt="record"]`. Don't use them for general route transitions.
21. **Direction-aware panels:** tabs, wizard steps and paged lists slide the incoming panel 14px in from the side of travel (next = from the right,
    previous = from the left), with opacity, at `--dur`. Use `useSlideDir(index)` (`components/data-pagination.tsx`; the pure `slideDir` is in `lib/motion.ts`)
    and `className="od-slide" data-slide={dir}` on a keyed panel (the `od-slide` and detail-sheet stagger CSS lives in `app/styles/kit.css`). Leave the attribute off on first render, because the page enter covers mount.
22. **Tables and paged lists: only page changes, sorting and row → detail move.**
    - Page change: use `<PagedBody page={page}>` instead of `<tbody>` (or `key={page}` + `od-slide` on a paged list). Rows slide in from the side of travel.
    - Filter and search: when the set of rows changes, `PagedBody` remounts and the whole body slides in from the right, like a next page.
      Rows stay plain `<tr>`, with no per-row enter/exit and no layout glide, because those made the table jump.
    - Column sort (`SortHeader`, first used on `/platform/tenants`): rows glide to their new place (FLIP, `motion.tr layout="position"`), but only while
      the sort changes, never on a filter. Pass `reorder` to `PagedBody` so a new order of the same rows doesn't remount the body.
    - Row → detail: the title morphs into the heading (rule 19).
23. **Progress fills that change after mount** (stepper, password strength) use `transform: scaleX()` with a transition, and `animation:none` on that bar,
    because a held `od-fill` keyframe blocks the transition.
24. **Sheets:** `DetailSheet` content staggers in after the panel slides (head, body blocks, footer; 40ms steps).
25. **Chat:** new messages rise in from the bottom only when they are added while the thread is open. Delivery ticks crossfade in one cell.
    Typing is shown as quiet grey dots. Voice progress is a clipped overlay layer, never a width change.
26. **Department switch:** a filtered figure never jumps. `CountUp` counts up once, then hands the value to `RollNumber`, so later changes roll per digit
    (down when the value fell; `numDir` in `lib/motion.ts`). `RollNumber` keys digit slots from the right. Stat data may carry `byDept` overrides.
    Recharts series stay mounted and ease to new data (`animationDuration` = `DUR.count` after the entrance). Short non-table card lists (daily-report rows, notifications) may use `AnimatePresence` + `listItem`; tables and paged lists stay static (rule 22).
27. **Popups grow from their trigger.**
    - Menus, selects, popovers, tooltips: one CSS rule in `opsdesk.css` keyed on their `data-slot`. Scale .96→1 + fade from base-ui's `--transform-origin`
      in `--dur`, close in `--dur-fast`. Don't add tw-animate zoom/slide classes back.
    - Panels (notifications, AI assistant): a `clip-path: inset()` that starts at the trigger's footprint and opens to the panel, no scale on content
      (same language as global search). The end clip sits outside the box (inset −Npx, radius N + the panel radius) so the shadow isn't cut and the
      last frame equals the resting panel. Content fades in from a third of the way; on close it fades first. Measured footprints use `growInset()`;
      measure with `transition:none`, or the measuring style pass itself starts a transition from the fallback.
28. **Action buttons:** `<ActionButton>` (`components/action-button.tsx`) for key saves/submits/approvals. The work runs first, with no artificial wait:
    errors and results show at once. The spinner (label kept invisible so width is locked) shows only while `onAction` is really async, then
    a ✓ stroke draw (`ACTION.done`) shows if the button is still on screen. `onAction` returns `false` when it didn't go through (no spinner, no ✓).
    `onDone` runs right after success and is for changes that remove the button (next task status, closing a sheet), so the status change
    and toast are immediate. `type="submit"` submits its form at once and skips the ✓ if a field is invalid.
    **Mistake to avoid:** a fixed minimum spinner made validation errors appear 0.4s late and status changes ~1.1s late. Press on every `.btn` / shadcn Button is `scale(.97)`; disabled = `cursor:not-allowed`, no press.
29. **Status changes:** `StatusPill` crossfades its tone colours (CSS), fades the new label; the width snaps. Never give it (or anything inside a
    `layout`-animated list row) its own motion `layout`: nested projection left labels stuck off their pills when the row moved.
    A change after mount shows a brief ✓ (pass `tick={false}` for changes the user didn't make). Never animates on mount.
30. **In-page tabs:** every tab or view switch inside a page, card or panel is `FilterSeg` (`components/filter-bar.tsx`):
    grey `--mute-bg` track, green sliding pill. Never hand-rolled chip or underline tabs. On the grey page background
    (task view tabs) the track is `--card`. Labels may carry a count (`<span className="num">`). Skeleton: one `Sk h={50} r="pill"`.
30. **Small feedback:** the invalid control shakes once (~6px, `--dur-slow`); a new error row opens with grid rows 0fr→1fr; an error replacing a hint only
    fades. Unread dots clear top→bottom `STAGGER` apart; the badge count rolls. The deadline countdown eases brand → warn in its last 15 minutes
    (`[data-warn]`). The chart tip is one element moved by transform (glides between bars, follows bars per frame while they animate).
    Copy actions swap their icon to ✓ the same way (`od-act-in` + `od-draw`; e.g. the tenant ID copy button on `/platform/tenants`).
31. **Long forms are pages:** a dialog that would need scrolling at 1568×698 becomes its own route (form page + exact skeleton); dialogs are for short confirmations and small forms.
    Form pages use `.od-form-cols` with two `.od-form-col` children (kit.css): two columns above 1100px, one below; the `.od-form-foot` sits after them, full width. Card uses the full content width.

## Data
Mock API lives in `public/data/<feature>/<name>.json`. Each feature's `features/<feature>/api.ts` reads it with `getData()`
from `lib/data.ts` on the server, and the data reaches components as props. Do not hard-code content in components.
This includes tenant-specific values (company, departments, deadline), because the product is multi-tenant SaaS.
Folder layout and import rules: `../architecture.md`.
