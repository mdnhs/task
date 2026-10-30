// Server-only: reads request cookies. Per-request device and two-step verification state (FR-M0-10, AC-M0-02/03).
import { cookies } from "next/headers"
import { getData } from "./data"
import { UNREGISTERED_ID, canUse, parseDevices, parsePolicies, unregisteredDevice } from "./devices"
import type { Device, DevicePolicy } from "./devices"
import { mfaRequired, needsMfaGate, parseMfaPolicy } from "./mfa"
import type { MfaPolicy } from "./mfa"
import type { Session } from "./session"

type Seed = { devices: Device[]; policies: DevicePolicy[]; mfaPolicy: MfaPolicy }
type SeedUser = { id: string; email: string }

const REG = (tenantId: string) => `od-devreg-${tenantId}`
const POL = (tenantId: string) => `od-devpol-${tenantId}`
const MFA_REQ = (tenantId: string) => `od-mfareq-${tenantId}`
export const DEVICE_COOKIE = "od-device"
export const MFA_COOKIE = "od-mfa"
export const deviceCookieNames = { REG, POL, MFA_REQ }

const readJson = (raw: string | undefined): unknown => {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

/** The signed-in person in this demo is the shell user; their id comes from the users list (matched by email). */
async function demoUserId(): Promise<string> {
  const [{ email }, { users }] = await Promise.all([getData<{ email: string }>("shell/user.json"), getData<{ users: SeedUser[] }>("settings/users.json")])
  return users.find((u) => u.email === email)?.id ?? ""
}

/** Seed register and policies with the tenant's saved changes (cookies) laid over them. */
export async function getDeviceRegister(session: Session): Promise<{ devices: Device[]; policies: DevicePolicy[]; mfaPolicy: MfaPolicy }> {
  const [seed, jar] = await Promise.all([getData<Seed>("settings/devices.json"), cookies()])
  const t = session.tenant.id
  const devices = parseDevices(readJson(jar.get(REG(t))?.value)) ?? seed.devices
  const policies = parsePolicies(readJson(jar.get(POL(t))?.value)) ?? seed.policies
  const mfaPolicy = parseMfaPolicy(readJson(jar.get(MFA_REQ(t))?.value), session.roles.map((r) => r.id)) ?? seed.mfaPolicy
  return { devices, policies, mfaPolicy }
}

export type DeviceContext = {
  userId: string
  /** The device this request comes from (cookie validated against the register). */
  current: Device
  /** What the demo switcher offers: this person's registered devices plus an unregistered browser. */
  options: Device[]
  policies: DevicePolicy[]
  canDrive: boolean
}

export async function getDeviceContext(session: Session): Promise<DeviceContext> {
  const [{ devices, policies }, userId, jar] = await Promise.all([getDeviceRegister(session), demoUserId(), cookies()])
  const mine = devices.filter((d) => d.userId === userId)
  // Default: the person's company PC, else their first device.
  const wanted = jar.get(DEVICE_COOKIE)?.value
  const fallback = mine.find((d) => d.type === "pc" && d.owner === "company") ?? mine[0]
  const current = wanted === UNREGISTERED_ID ? unregisteredDevice() : (mine.find((d) => d.id === wanted) ?? fallback ?? unregisteredDevice())
  return { userId, current, options: [...mine, unregisteredDevice()], policies, canDrive: canUse("drive", current, policies) }
}

/** Is this person's two-step verification set up? (security seed, or the mock setup flow). */
export async function getMfaState(session: Session) {
  const [{ mfaPolicy }, jar, sec] = await Promise.all([getDeviceRegister(session), cookies(), getData<{ mfa: boolean }>("account/security.json")])
  const flag = jar.get(MFA_COOKIE)?.value
  const enrolled = flag === "0" ? false : flag === "1" || sec.mfa
  return { policy: mfaPolicy, enrolled, required: mfaRequired(mfaPolicy, session.role.id), gate: needsMfaGate(mfaPolicy, session.role.id, enrolled) }
}
