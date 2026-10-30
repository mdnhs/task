"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { MFA_COOKIE, deviceCookieNames, getMfaState } from "@/lib/device-session"
import { parseDevices, parsePolicies } from "@/lib/devices"
import type { Device, DevicePolicy } from "@/lib/devices"
import { mfaRequired, parseMfaPolicy, verifyMockTotp } from "@/lib/mfa"
import type { MfaPolicy } from "@/lib/mfa"
import { canWrite, getSession } from "@/lib/session"

const opts = { path: "/", sameSite: "lax" as const }

// Mock persistence for the device register, policies and the two-step rule: per-tenant cookies that
// getDeviceRegister() lays over the seed. Settings write access only, every input validated.
export async function saveDevices(devices: Device[]) {
  const session = await getSession()
  const list = parseDevices(devices)
  if (!session.signedIn || !canWrite(session, "settings") || !list) return { ok: false as const }
  const jar = await cookies()
  jar.set(deviceCookieNames.REG(session.tenant.id), JSON.stringify(list), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

export async function saveDevicePolicies(policies: DevicePolicy[]) {
  const session = await getSession()
  const list = parsePolicies(policies)
  if (!session.signedIn || !canWrite(session, "settings") || !list) return { ok: false as const }
  const jar = await cookies()
  jar.set(deviceCookieNames.POL(session.tenant.id), JSON.stringify(list), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

export async function saveMfaPolicy(policy: MfaPolicy) {
  const session = await getSession()
  const next = parseMfaPolicy(policy, session.roles.filter((r) => !r.platform).map((r) => r.id))
  if (!session.signedIn || !canWrite(session, "settings") || !next) return { ok: false as const }
  const jar = await cookies()
  jar.set(deviceCookieNames.MFA_REQ(session.tenant.id), JSON.stringify(next), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

// FR-M0-03: mock TOTP check (fixed code) in two steps, so recovery codes can be shown before the page re-renders.
// verifyMfaCode only marks the check as passed; finishMfaSetup (after the person saved the codes) enrols them.
export async function verifyMfaCode(code: string) {
  const session = await getSession()
  if (!session.signedIn || typeof code !== "string" || !verifyMockTotp(code)) return { ok: false as const }
  const jar = await cookies()
  jar.set("od-mfa-check", "1", opts)
  return { ok: true as const }
}

export async function finishMfaSetup() {
  const session = await getSession()
  const jar = await cookies()
  if (!session.signedIn || jar.get("od-mfa-check")?.value !== "1") return { ok: false as const }
  jar.delete("od-mfa-check")
  jar.set(MFA_COOKIE, "1", opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

export async function disableMfa() {
  const session = await getSession()
  if (!session.signedIn) return { ok: false as const }
  // A required rule cannot be switched off by the person it applies to.
  const { policy } = await getMfaState(session)
  if (mfaRequired(policy, session.role.id)) return { ok: false as const }
  const jar = await cookies()
  jar.set(MFA_COOKIE, "0", opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}
