// Server-only: reads request cookies. Per-request device and two-step verification state (FR-M0-10, AC-M0-02/03).
import { cookies } from "next/headers"
import { getData } from "./data"
import { parseDevices, parsePolicies } from "./devices"
import type { Device, DevicePolicy } from "./devices"
import { mfaRequired, parseMfaPolicy } from "./mfa"
import type { MfaPolicy } from "./mfa"
import { getTenantRoles } from "./roles-data"
import type { Session } from "./session"

type Seed = { devices: Device[]; policies: DevicePolicy[]; mfaPolicy: MfaPolicy }

const REG = (tenantId: string) => `od-devreg-${tenantId}`
const POL = (tenantId: string) => `od-devpol-${tenantId}`
const MFA_REQ = (tenantId: string) => `od-mfareq-${tenantId}`
export const deviceCookieNames = { REG, POL, MFA_REQ }

const readJson = (raw: string | undefined): unknown => {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/** Seed register and policies with the tenant's saved changes (cookies) laid over them. */
export async function getDeviceRegister(session: Session): Promise<{ devices: Device[]; policies: DevicePolicy[]; mfaPolicy: MfaPolicy }> {
  const [seed, jar] = await Promise.all([getData<Seed>("settings/devices.json"), cookies()])
  const t = session.tenant.id
  const devices = parseDevices(readJson(jar.get(REG(t))?.value)) ?? seed.devices
  const policies = parsePolicies(readJson(jar.get(POL(t))?.value)) ?? seed.policies
  const mfaPolicy = parseMfaPolicy(readJson(jar.get(MFA_REQ(t))?.value), (await getTenantRoles()).map((r) => r.id)) ?? seed.mfaPolicy
  return { devices, policies, mfaPolicy }
}

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
