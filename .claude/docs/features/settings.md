# Settings, account, audit and search (M0 tenant administration)

Built on the real API in B6 T6.5. Tenant-default notification settings, the delivery log and the report template tab are still mock and show only on a demo deployment (`ENABLE_MOCK_MODULES=1`).

## What the UI no longer offers, and why
| Removed or changed | Why |
|---|---|
| Weekend and holiday rule | The API has public holidays instead (`/v1/settings/holidays`); no rule setting exists. |
| Department sites | Move to rosters (M1A). |
| Department report owner, deactivate department | Report ownership is B8; teams have no active flag. |
| Appearance presets (corners, text, spacing) | No backend field; the brand colour is kept. |
| Workspace deletion request | It was a fake toast; there is no such API. The real data-request flow (export, erase, correct a person) replaced it. |
| Integrations other than Google Drive | Later modules; the API has Google only. |
| Logo upload | Hidden (`LOGO_UPLOAD_ENABLED = false`): the shell cannot show a logo because `/v1/me/tenant` has no logo field. Code kept; expose the logo there in a later phase, then switch it on. |
| Session timeout | Shown read-only from `sessionIdleHours`; the platform sets it for now. |
| Built-in roles in the matrix | Read-only in the API (409 `template_locked`). "Copy role" makes an editable copy. |

## Audit
`GET /v1/audit` (B7 S7) answers `{ items, nextCursor }`: pages of 100 (`limit` 1 to 100, default 50), newest first in chain order (`seq` desc, so entries with equal timestamps never reorder or repeat). Filters: `entity`, `actorId` (the opaque member id, not a uuid), `action` (exact) or `actionPrefix` (literal; both is 400 `invalid_filter`), `from`, `to` (inclusive; `to` before `from` is 400 `invalid_range`). The cursor is the shared opaque codec (`api/src/core/cursor.ts`, `<at>|<id>`) resolved to its row inside the caller's tenant, so a garbage, forged or other-tenant cursor is 400 `invalid_cursor`. The CSV export takes the same filters (not paged) and records them in its own `audit.exported` entry. Reads never write; the chain is untouched. The web view sends actor, action, record type and dates to the API, follows the cursor with "Load older", and filters only the text search (and "System", which has no actor id) on the loaded rows. The platform console audit (`/v1/platform/audit`) is a separate route and unchanged.

## Users: deactivate and last active (B8 Task 24)

Settings -> Users lists `GET /v1/people?status=all` (settings:read) with the API's **Status** pill (Active / Deactivated) and **Last active** (`lastActiveAt` in tenant wall time; null = "Never"). With settings:write: **Deactivate** asks first (ConfirmDialog) and calls `POST /v1/members/{id}/deactivate`; **Reactivate** is one call (`.../reactivate`, needs a free seat: off when the plan is full). Yourself and the last active owner have the control disabled with the reason as its title; the API refuses too and the refusal is the app's copy (`409 last_owner`, `422 self_deactivation`, `409 already_deactivated | not_deactivated | seat_limit`). The row takes the API's answer at once, then the refresh. The old demo-only columns (`mockActivity`, `getMockUserActivity`, the `settings/users.json` reader) are gone; that seed is read only by the demo seed script now. Devices and Privacy still list the active people only.

