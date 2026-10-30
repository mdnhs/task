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

Feature docs for the later full-UI pages live in `features/<feature>.md`:

| Doc | Feature |
|-----|---------|
| `features/shift-reports.md` | Shift Reports `/daily-reports` (FR-M1-22..31, CR-01, CR-03): per-member end-of-shift report, inbox, review, missing alerts, export |
| `features/tasks.md` | Tasks `/tasks` + board, calendar, projects, archive (FR-M1-01..14, FR-M1-40..48, CR-04/05): evidence rules, planning model, routes, assumptions Q6/Q8 |
| `features/shifts.md` | Shifts `/shifts` (FR-M1-20/21, FR-M0-07): shift model `lib/shifts.ts`, patterns, assignments, reporting on/off, reporting lines; hand-off for the step 2 shift report |
| `features/devices.md` | Devices and platform security (mock): device register and policy, Drive on trusted PCs only, MFA rule and gate, SSO buttons. Deploy guide: `deploy/google-drive-android.md` |
| `features/platform.md` | Platform console `/platform/**` (SaaS admin, FR-M0-01/02/13/14/15/19): routes, staff roles and permission table, metrics (MRR, NRR cohort rule), health score, store patch contract, privacy rule D8, ⌘K palette, mock limits |
| `features/whatsapp.md` | WhatsApp inbox `/whatsapp` (SRS §3.17): integration status, voice-note transcripts, link/create task, gates |
| `search/brief.md` | Global topbar search (FR-AUD-01): one-surface clip-path panel, lazy role-filtered index, shortcuts |

Layout grid (desktop, content area): 4 stat cards row → [chart 2/3 | deadline 1/3] → [attention 2/3 | progress 1/3] → [team tasks 2/3 | coverage 1/3].

## Source of truth (updated)
Exact reference is now `~/Downloads/task_light.html` + `task_dark.html` (light + dark). Their CSS is ported verbatim into
`app/opsdesk.css`; components (now in `features/<feature>/components/`) mirror the HTML markup 1:1. Only deliberate deviations: desktop icon-collapse
(`.app.collapsed`, menu button always visible), font via next/font, `[hidden]` rule for the department filter.
Hex values listed in the per-feature briefs are superseded by the CSS variables in `app/opsdesk.css`.

## Must read before any new UI
- `architecture.md`: feature-based folder structure (`features/<feature>/`), import rules, how to add a feature.
- `00-design-system/ui-rules.md`: how to skin shadcn components with OpsDesk tokens (popover/dropdown mistake) and where mock data lives (`public/data`).
- `requirements/SRS.md`: the main spec since 28 Oct 2026, "AI Business OS" by the BA (modules M0–M9, phases, CR-01..06, FR-Mx-nn IDs). Appendix A (engineering) has build status, old-to-new ID mapping and the Phase 1 front-end plan.
- `requirements/SRS-v1.2-built.md`: the old OpsDesk SRS v1.2, kept as the record of what was built (route map §5.3, traceability Appendix A, mock status Appendix B). Old IDs in code comments refer to it.
- `requirements/srs-diff-2026-10-28.md`: full comparison of the two specs and the app.

Note: the per-feature `plan.md` files below are historical build plans. The file paths in them (`components/*.tsx`) predate the
feature-based move. Current locations: dashboard widgets are in `features/dashboard/components/`, and the sidebar, topbar and NavUser are in `features/shell/components/`.
