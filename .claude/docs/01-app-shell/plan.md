# 01 App shell – plan
Files: rewrite `components/app-sidebar.tsx`, `components/site-header.tsx`, `components/nav-main.tsx`, `nav-secondary.tsx`; delete unused `nav-documents.tsx`, `nav-user.tsx` (or repurpose user chip into header).
1. Sidebar: keep shadcn `Sidebar variant="inset" collapsible="icon"` (user asked icon-collapse earlier). Use lucide icons
   (LayoutGrid, SquareCheck, FileText, Flag, CalendarDays, UserPlus, Folder, Wallet/Lock, Package, Settings, History, CircleHelp, LogOut).
2. Active item styling: green text + 3px left green indicator; badges via `SidebarMenuBadge` (green 14, red 4).
3. Header: replace with search pill + chips (`ToggleGroup` or simple buttons, state in client component) + mail/bell + user chip.
   Keep `SidebarTrigger` (place left of search or inside sidebar header) so collapse still works.
4. Wrap main in `SidebarInset` with padding; ensure content panel radius/bg per 00.
5. Mobile: sidebar becomes sheet (shadcn default); top bar search shrinks, chips scroll.

## Addendum: phone department row, collapsed badges, platform skeleton
- ≤640px: `DeptSeg` is hidden and `DeptRow` (features/shell/components/dept-row.tsx) sits under the search: full width, scroll-snap, no scrollbar, 44px pills, active pill (layoutId `dept-row-active`) centred on change. Skeleton: `.sk-dept-row` (52px) in `AppShellSkeleton`.
- Sidebar badges come from `navigation.json` (`badge`); in the icon-collapsed rail they stay visible, pinned top-right of the icon (shell.css).
- `AppShellSkeleton departments={false}` renders no department filter (platform console).
