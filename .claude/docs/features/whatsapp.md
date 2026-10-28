# WhatsApp inbox (`/whatsapp`)

SRS §3.17 (FR-WA-01..08), open question OC-05. An in-app inbox for staff and client WhatsApp messages and voice notes,
in the OpsDesk look (WhatsApp cues only: bubbles, ticks, voice notes). Everything is mock data until the client confirms
the provider, the business number and which flows they want.

## Files
- Route: `app/(app)/whatsapp/{page,loading,layout}.tsx`. `layout.tsx` only imports `app/styles/whatsapp.css`
  (so the skeleton gets it too; `app/layout.tsx` is shared).
- Feature: `features/whatsapp/` — `types.ts`, `api.ts` (`getWhatsapp(tenantId)`), `store.ts` (`whatsappStore`),
  `logic.ts` (pure store actions, gates, filters; tested in `logic.test.ts`), `components/`.
- Data: `public/data/whatsapp/conversations.json`, `integration.json` (per tenant, `default` for new tenants), `link-targets.json`.
- Wiring: module `whatsapp` in `lib/types.ts`, prefix in `lib/permissions.ts`, access per role in `public/data/shell/roles.json`,
  nav item in `public/data/shell/navigation.json` (icon `chat`). Smoke cases: `scripts/smoke/whatsapp.json`.

## Layout
- Page head, integration card (status, provider, method, number, last sync, one tile per flow with Enabled/Pending,
  failure alert with Reconnect when disconnected, privacy + consent note from data).
- Inbox `.wa-inbox`: conversation list (search + All / Unread / Linked / Unlinked / Voice) | thread | context panel
  (contact, consent, linked records, activity). Fixed height; list and thread scroll inside.
- ≤1240px: context panel moves into a `DetailSheet` (info button in the thread header).
- ≤900px: one pane at a time (`data-view="list" | "thread"`), back button in the thread header.

## Rules it implements
- **Gates (`gates()` in `logic.ts`, FR-WA-04):** read-only roles (and suspended tenants) can't send, link, create tasks or
  confirm transcripts; the composer is disabled (`cursor:not-allowed`) with the reason underneath. Sending also needs the
  `outbound` flow enabled and a connected integration; task creation needs the `task_creation` flow and write access to Tasks;
  transcripts need the `voice` flow.
- **Audit:** every link, task create and transcript confirm appends an event row in the thread ("Linked to TSK-1004 by …");
  replies carry the sender's name. The context panel's Activity list is built from those.
- **Transcripts (FR-WA-03/05/07):** badge "Machine-generated — not confirmed" until Confirm or Edit → Save and confirm.
  States: transcribing (mock: finishes after 4 s), failed (Retry), unsupported audio (no player, reason shown),
  low confidence (< `LOW_CONFIDENCE` = 0.7) warning.
- **Mock provider:** a sent reply turns Delivered after 1.2 s; a failed reply offers Try again.
- Tasks created here get the next `TSK-…` ref and link back to the message, but live only in this feature's store
  (features don't import each other); wiring them into the Tasks store needs a backend.

## Demo tenants
- `t1`: awaiting client confirmation, inbound/outbound/task creation/voice enabled, alerts pending.
- `t2`: only inbound enabled (composer, task creation and transcripts show their "waiting for client confirmation" reasons).
- `t3`: disconnected (FR-WA-07 failure alert, sending blocked).
