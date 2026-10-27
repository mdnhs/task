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
6. Must work in light and dark. Check both (`[data-theme="dark"]`), tokens already switch, so never
   hard-code hex colors unless the original HTML does.
7. Verify in the browser next to the existing topbar/cards before reporting done.

8. This UI is borderless and generously rounded: cards `--r-lg`, topbar `--r-xl`, controls `--r-pill`.
   Never add 1px borders or small radii (`rounded-md/lg`) to new surfaces. Copy the radius of the nearest
   existing surface.

9. Dark mode: `--brand-deep` is near-black in dark, so never use it as text on `--brand-soft` there;
   use `--brand-3`. Always hover-test menus in dark.

10. Hover colors must contrast with the surface *behind* the element too. `--mute-bg` ≈ `--panel`, so a
    hovered white control on the topbar looks transparent; use `--line` for a grey hover there.

11. Every page and data-driven component ships with a skeleton that matches it exactly (same classes, measured `lh`, same counts).
    Use `Sk` from `components/sk.tsx`. Do not use shadcn's `Skeleton`: its `bg-muted` and `animate-pulse` are not OpsDesk tokens.
    Full rules are in `../architecture.md` → Skeletons.

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
        - the department filter pill, `seg-active` / `.seg-ind`
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
      - Without JS or with reduced motion, nothing is held.
    - To add another element type, add its selector to `REVEAL` and write a matching hold rule in CSS. Don't write a per-component IntersectionObserver.
    - **JS-driven animations follow the same rule.** Use `useInView(ref, { once: true, margin: "0px 0px -10% 0px" })` from `motion/react`.
      - `CountUp` does this internally, so every count-up waits for view.
      - **Recharts:** mount the animated series only when `inView` (`{inView && <Bar…/>}` / `<Pie…/>`). Recharts animates on mount, so a chart below the fold would otherwise finish before anyone sees it.
        Done in `tasks-closed-chart.tsx` and `task-progress.tsx`. Also pass `isAnimationActive={!useReducedMotion()}`.
      - Every new chart or gauge must do the same.
      - Rows entering or leaving a filtered list: `AnimatePresence` + `listItem`.
      - Drag to reorder: `Reorder.Group/Item` + `.od-drag`.
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
19. View Transitions are used only for the theme toggle's circular reveal (`nav-user.tsx`). Route transitions with View Transitions are experimental in Next/React, so they are not used yet; check `node_modules/next/dist/docs/` before trying.

## Data
Mock API lives in `public/data/<feature>/<name>.json`. Each feature's `features/<feature>/api.ts` reads it with `getData()`
from `lib/data.ts` on the server, and the data reaches components as props. Do not hard-code content in components.
This includes tenant-specific values (company, departments, deadline), because the product is multi-tenant SaaS.
Folder layout and import rules: `../architecture.md`.
