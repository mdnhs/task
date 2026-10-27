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
