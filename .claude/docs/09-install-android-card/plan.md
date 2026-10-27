# 09 Install on Android card – plan
File: `components/install-card.tsx`, rendered in `SidebarFooter` (`group-data-[collapsible=icon]:hidden`).
Background: dark green gradient + inline SVG wave lines. Button handler: capture `beforeinstallprompt` event and call `prompt()` (graceful no-op otherwise).
Footer note: add to `app/page.tsx` bottom, 10px muted text.
