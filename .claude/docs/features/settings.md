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
| User deactivate and last active | No API route. Shown only on demo deployments (mock, local to the tab, never calls the API). |
| Built-in roles in the matrix | Read-only in the API (409 `template_locked`). "Copy role" makes an editable copy. |

## Branding (brand colour and neutral tint)
`lib/brand.ts` `brandCss()` is the single source, rendered server-side in `app/(app)/layout.tsx` (no flash) and re-run by the Branding live preview. Besides the accent tokens it now tints the neutral surface scale (`--page --shell --panel --card --ink --ink-2 --ink-3 --placeholder --line --mute-bg --shadow`, light and dark; `lib/brand-neutrals.ts`): each neutral keeps its exact luminance (contrast unchanged), takes the brand hue (its offset from the default hue kept) and its own small chroma scaled by the brand's chroma (greys give greys, loud brands are capped). The default green emits nothing, so `opsdesk.css` stays the default; those hexes are mirrored in `DEFAULT_NEUTRALS_*` (a test keeps them in step and forbids the hexes anywhere else). Platform console and auth pages never get a tenant brand.

## Audit
`GET /v1/audit` (B7 S7) answers `{ items, nextCursor }`: pages of 100 (`limit` 1 to 100, default 50), newest first in chain order (`seq` desc, so entries with equal timestamps never reorder or repeat). Filters: `entity`, `actorId` (the opaque member id, not a uuid), `action` (exact) or `actionPrefix` (literal; both is 400 `invalid_filter`), `from`, `to` (inclusive; `to` before `from` is 400 `invalid_range`). The cursor is the shared opaque codec (`api/src/core/cursor.ts`, `<at>|<id>`) resolved to its row inside the caller's tenant, so a garbage, forged or other-tenant cursor is 400 `invalid_cursor`. The CSV export takes the same filters (not paged) and records them in its own `audit.exported` entry. Reads never write; the chain is untouched. The web view sends actor, action, record type and dates to the API, follows the cursor with "Load older", and filters only the text search (and "System", which has no actor id) on the loaded rows. The platform console audit (`/v1/platform/audit`) is a separate route and unchanged.
