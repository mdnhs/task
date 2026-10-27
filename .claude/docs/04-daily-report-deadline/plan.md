# 04 Daily Report Deadline – plan
File: `components/daily-report-deadline.tsx` (client component).
1. `useEffect` interval 1s computing diff to 17:30 Europe/London today; fall back to static 00:31:16 for prototype fidelity (prop `staticNow`).
2. Tiles: `bg-green-50 rounded-xl`, number 28px semibold, label 9px uppercase muted.
3. Use `StatusPill` (00) for Submitted/Draft; `Progress` shadcn (add `npx shadcn add progress`) styled amber.
4. Button click → `toast` ("Reminder sent") via existing sonner.
