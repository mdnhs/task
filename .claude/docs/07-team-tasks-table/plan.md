# 07 Team Tasks table – plan
Replace `components/data-table.tsx` (dnd/tanstack version is overkill) with `components/team-tasks-table.tsx` using shadcn `Table` (already installed).
Remove `@dnd-kit/*`, tanstack deps & `app/data.json` if unused after. Data in `lib/sample-data.ts`.
Sub-components: `AssigneeCell` (avatar bg colour per user), `PriorityBars` (3 bars, level 1–3, colour by level), `StatusPill` (00).
Responsive: wrap in `overflow-x-auto`, min width ~680px.
