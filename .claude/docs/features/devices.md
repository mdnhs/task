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
