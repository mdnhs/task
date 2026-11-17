# Devices and platform security (mock)

SRS: CR-02, CR-06, FR-M0-03, 04, 08, 09, 10, FR-M1-50..53, AC-M0-02, AC-M0-03, AC-M1-06. Appendix A.4 steps 5 and 9.

## Device register and policy
- Pure model `lib/devices.ts`: `Device`, `DevicePolicy`, `canUse(feature, device, policies)`, `resolveDevice`, `parseDevices/parsePolicies` (validate cookie input), `isDriveUrl`.
- Seed: `public/data/settings/devices.json` (devices, policies, default two-step rule). Account sessions (`account/security.json`) are login sessions, not the register, so they stay separate.
- Server: `lib/device-session.ts` reads cookies on every request. `od-device` (current device id, validated against the signed-in person's register, else the unregistered browser), `od-devreg-<tenant>` and `od-devpol-<tenant>` (saved register and policies), written by server actions in `app/actions/security.ts` (settings write access only, input validated). `setDevice` in `app/actions/session.ts` sets the demo device.
- Demo switcher: user menu, "Device (preview)": Work PC, Android phone, Unregistered browser.
- Settings: Devices tab (add, remove, trusted toggle), Integrations tab "Device access" card (per feature: trusted company PCs, any, none).
- Drive UI: `components/drive-link.tsx` takes `allowed` from the server. Used in task evidence for Google Drive links. Untrusted device: "Available on your work PC", no link; adding a Drive link is refused.
- Google-side block (FR-M1-53): `.claude/docs/deploy/google-drive-android.md`.

## Two-step verification
- `lib/mfa.ts`: mock TOTP (fixed secret, code `123456`), recovery codes, rule `{mode: off|all|roles, roles}`, `needsMfaGate`.
- Sign-in page: "Continue with Google" / "Continue with Microsoft" (mock, sign in as the seed user), email and password kept.
- Account, Security: set-up dialog (QR placeholder, secret, code check, recovery codes). `od-mfa` cookie = enrolled.
- Settings, Roles: "Two-step verification" rule (`od-mfareq-<tenant>`). When required and not enrolled, `app/(app)/layout.tsx` renders `MfaGate` instead of the page (AC-M0-02). A person the rule applies to cannot switch it off.

## Backend notes (B6 T6.1: the shell's view of the device)
`GET /v1/me/tenant` now returns `device { id | null, type, label, trusted }` (id is null for the unregistered browser) and `features.drive`, both evaluated for THIS request's device and the tenant's Drive policy (never cached, so revoking trust bites on the next request). It also carries `tenant.name`, `brand.primaryColor`, `reportDeadline` and `reportDueAfterMinutes`, because staff cannot read settings and the shell needs them. `GET /v1/me` returns the user's `name`, `emailVerified`, `twoFactorEnabled` and the `platformRole` (null unless an ACTIVE staff row exists). New API middleware `requireSameOrigin` (`core/middleware/origin.ts`, mounted on `/v1/*`): a non-GET with a present, foreign `Origin` is `403 bad_origin`, before authentication; no `Origin` and `Bearer odk_` keys pass.

## Backend notes (B6 T6.3: the shell's device chip)
The user menu shows a read-only chip with `me/tenant.device.label` ("Company PC", "Unregistered browser"); the demo "Device (preview)" switcher is gone. `features.drive` (and so the Drive links on a task) is the API's answer for THIS request's device. The signed `__Host-od-device-*` cookie set by `POST /v1/devices/{id}/bind` reaches the browser unchanged through the BFF and is forwarded by server components. `GET /v1/me/tenant` also returns `member.role` `{ label, description, home, access }` (the caller's own role), because staff roles cannot read `GET /v1/roles`.

## Backend notes (B6 T6.5: retire, invites, rename)
- `DELETE /v1/devices/{id}` retires a device (settings:write, 204): the row and its binding are deleted, audited `device.retired` (what it was and whether it was bound; never a code, a binding or a hash). The cookie that named it no longer matches any device, so that browser is the unregistered browser from its next request. Open to a read-only (blocked) company, like un-trusting.
- Invites: `GET /v1/invites` lists unaccepted invites (settings:write, newest first, no token or hash), `DELETE /v1/invites/{id}` revokes (204, audited `invite.revoked`, open to a blocked company), `POST /v1/invites/{id}/resend` rotates the token and sends ONE mail (the old link stops working, the expiry restarts, the resender becomes the inviter of record, the escalation rule R24 is judged on the invited role, 429 `resend_too_soon` inside 60 s; `created_at` is the time of the last send). Accept re-validates the inviter: a demoted, suspended or removed inviter, or an invited role above the inviter's current access, is 410 `invite_invalid` and nothing is written.
- Renaming a team rewrites the matching report-template department in the same transaction (the template is keyed by team name); a name the template already holds is 409 `template_dept_exists`; the `team.updated` audit entry carries `reportTemplateRenamed`.
- Notifications `POST /v1/notifications/{id}/read` and `/read-all` stay open to a blocked company (they change no business data).
