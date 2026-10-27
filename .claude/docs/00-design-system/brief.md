# 00 Design system – brief
Light theme only (PDF is light). App background is a pale grey-green (~#E9EEEA); the whole app sits inside a rounded outer
"frame"; sidebar and top bar are rounded panels, main content is another rounded panel (slightly darker grey-green ~#EEF1EE)
holding white cards.

- **Primary green:** deep green ~#1B8A3A (buttons, active nav, "Open Tasks" card gradient, deadline text, links "Decide").
- **Chart greens:** weekday bar ~#3E7F4F (dark), today bar ~#5DB885 (light), weekend = diagonal-striped light green.
- **Status colours (soft pill bg + text/dot):** red (Urgent/Blocked/overdue/late), orange-amber (High/Draft/In progress/Changes requested),
  blue (Normal/Submitted for review), green (Completed/Submitted), grey (Not started).
- **Typography:** geometric sans similar to *Plus Jakarta Sans* (page title 28–30px bold, card titles 14px semibold,
  big KPI numbers 40–44px semibold, meta text 10–11px muted grey).
- **Radii:** cards ~16–20px, outer panels ~24px, pills fully rounded, small icon tiles ~10px.
- **Shadows:** almost none; white cards on grey-green panel. **No borders** on cards/menus/popovers (the real HTML is borderless).
- Muted text colour ~#7B857E; body text near-black ~#1A1F1C.

## Hard rules learned from past mistakes (full detail: `ui-rules.md`)
- Popovers/dropdowns/menus must use OpsDesk tokens, never stock shadcn colors/ring/`rounded-lg`.
- The UI is borderless: no 1px borders on new surfaces; separate with background + `--shadow`.
- Radius: cards `--r-lg` (20px), topbar `--r-xl`, controls and menu items `--r-pill`. Copy the nearest existing surface.
- No default green focus ring on popups; highlight items with `--brand-soft`.
- Check light and dark in the browser before saying done.
- Mock content lives in `public/data/<feature>/*.json`, never hard-coded in components.
