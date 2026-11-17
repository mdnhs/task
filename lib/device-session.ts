// Server-only: this request's device and two-step verification state (FR-M0-10, AC-M0-02). B6 T6.5: all of it is the API's answer; the mock register, policy and
// two-step cookies are gone (the register is GET /v1/devices, the policies GET /v1/device-policies, the rule GET /v1/settings/mfa-policy).
import type { MfaPolicy } from "./mfa"
import { mfaRequired } from "./mfa"
import type { Session } from "./session"

export type DeviceContext = {
  /** The device this request comes from, as the API resolved it from the signed device cookie (CR-02). Read-only: no switcher. */
  current: { id: string | null; label: string; trusted: boolean }
  /** `features.drive` from /v1/me/tenant: the API evaluated the Drive policy for THIS request's device. */
  canDrive: boolean
}

/** B6 T6.3: the device and Drive availability are the API's answer (never a cookie the page could choose). */
export async function getDeviceContext(session: Session): Promise<DeviceContext> {
  return { current: session.device, canDrive: session.drive }
}

/** Two-step verification state from the session: enrolled = this person has 2FA; the gate is the API's 401 mfa_enrolment_required (AC-M0-02). */
export async function getMfaState(session: Session) {
  const policy: MfaPolicy = session.mfaPolicy
  return { policy, enrolled: session.twoFactorEnabled, required: mfaRequired(policy, session.role.id), gate: session.mfa === "enrol" }
}
