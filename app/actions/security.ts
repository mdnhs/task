"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { deviceCookieNames } from "@/lib/device-session"
import { parseDevices, parsePolicies } from "@/lib/devices"
import type { Device, DevicePolicy } from "@/lib/devices"
import { parseMfaPolicy } from "@/lib/mfa"
import type { MfaPolicy } from "@/lib/mfa"
import { getTenantRoles } from "@/lib/roles-data"
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
  const next = parseMfaPolicy(policy, (await getTenantRoles()).map((r) => r.id))
  if (!session.signedIn || !canWrite(session, "settings") || !next) return { ok: false as const }
  const jar = await cookies()
  jar.set(deviceCookieNames.MFA_REQ(session.tenant.id), JSON.stringify(next), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}
