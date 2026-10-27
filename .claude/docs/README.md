# OpsDesk dashboard – docs index

Source of truth: `task_light.pdf` (light-mode design, "OpsDesk"). Goal: pixel-faithful clone on the current stack
(Next.js App Router, Tailwind v4, shadcn/ui `dashboard-01` base, recharts via `components/ui/chart.tsx`).
Everything renders on `/` (`app/page.tsx`). Data is static sample data (prototype for client review, London time GMT).

Each folder = one feature, with `brief.md` (what / exact visuals) and `plan.md` (how / files / steps).
Do them in numeric order; 00 and 01 block everything else.

| # | Feature |
|---|---------|
| 00 | design-system (tokens, font, radii, shadows) |
| 01 | app-shell (sidebar + top bar + content frame) |
| 02 | page-header-stat-cards |
| 03 | tasks-closed-chart |
| 04 | daily-report-deadline |
| 05 | manager-attention |
| 06 | task-progress (gauge) |
| 07 | team-tasks-table |
| 08 | coverage-and-files |
| 09 | install-android-card |

Layout grid (desktop, content area): 4 stat cards row → [chart 2/3 | deadline 1/3] → [attention 2/3 | progress 1/3] → [team tasks 2/3 | coverage 1/3].

## Source of truth (updated)
Exact reference is now `~/Downloads/task_light.html` + `task_dark.html` (light + dark). Their CSS is ported verbatim into
`app/opsdesk.css`; components (now in `features/<feature>/components/`) mirror the HTML markup 1:1. Only deliberate deviations: desktop icon-collapse
(`.app.collapsed`, menu button always visible), font via next/font, `[hidden]` rule for the department filter.
Hex values listed in the per-feature briefs are superseded by the CSS variables in `app/opsdesk.css`.

## Must read before any new UI
- `architecture.md`: feature-based folder structure (`features/<feature>/`), import rules, how to add a feature.
- `00-design-system/ui-rules.md`: how to skin shadcn components with OpsDesk tokens (popover/dropdown mistake) and where mock data lives (`public/data`).
- `requirements/SRS.md`: full project requirements. It is SRS v1.1: the v1.0 `.docx` plus the SaaS/multi-tenant and Stripe billing additions (§3.20).

Note: the per-feature `plan.md` files below are historical build plans. The file paths in them (`components/*.tsx`) predate the
feature-based move. Current locations: dashboard widgets are in `features/dashboard/components/`, and the sidebar, topbar and NavUser are in `features/shell/components/`.
