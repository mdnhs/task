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

## Audit
The API returns the newest 1,000 entries. Record type and dates go in the query; actor, action and text filter the loaded rows. The CSV export uses the record type and dates only. Real actor, action and cursor filters are a B7/B8 item.
