"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { getDeviceContext } from "@/lib/device-session"
import { parseAppearance, type Appearance } from "@/lib/appearance"
import { canWrite, getSession } from "@/lib/session"

const opts = { path: "/", sameSite: "lax" as const }

// Demo switchers ("View as", "Switch company") stay in this demo deployment, but only accept ids from the seed lists,
// and only for a signed-in session.
export async function setRole(id: string) {
  const session = await getSession()
  if (!session.signedIn || typeof id !== "string" || !session.roles.some((r) => r.id === id)) return
  const jar = await cookies()
  jar.set("od-role", id, opts)
  if (id === "platform") redirect("/platform")
  revalidatePath("/", "layout")
}

export async function setTenant(id: string) {
  const session = await getSession()
  if (!session.signedIn || typeof id !== "string" || !session.tenants.some((t) => t.id === id)) return
  const jar = await cookies()
  jar.set("od-tenant", id, opts)
  revalidatePath("/", "layout")
}

// Demo "current device" switcher (CR-02): only ids from the signed-in person's register, or the unregistered browser.
export async function setDevice(id: string) {
  const session = await getSession()
  if (!session.signedIn || typeof id !== "string") return
  const { options } = await getDeviceContext(session)
  if (!options.some((d) => d.id === id)) return
  const jar = await cookies()
  jar.set("od-device", id, opts)
  revalidatePath("/", "layout")
}

export async function signIn(roleId?: string) {
  const { roles } = await getSession()
  const role = typeof roleId === "string" && roles.some((r) => r.id === roleId) ? roleId : undefined
  const jar = await cookies()
  jar.delete("od-auth")
  if (role) jar.set("od-role", role, opts)
  redirect(role === "platform" ? "/platform" : "/")
}

// Mock persistence for tenant branding (FR-SAAS-11): a per-tenant cookie that getSession() merges over the seed.
export async function saveBranding(input: { name: string; color: string; appearance?: Appearance }) {
  const session = await getSession()
  if (!canWrite(session, "settings")) return { ok: false as const }
  const name = input.name.trim().slice(0, 60)
  const color = input.color.toLowerCase()
  if (name.length < 2 || !/^#[0-9a-f]{6}$/.test(color)) return { ok: false as const }
  const jar = await cookies()
  const appearance = parseAppearance(input.appearance ?? session.tenant.appearance)
  jar.set(`od-brand-${session.tenant.id}`, JSON.stringify({ name, color, appearance }), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

export async function signOut() {
  const jar = await cookies()
  jar.set("od-auth", "out", opts)
  // Drop the role and company too, so nothing (e.g. the platform console) keeps working off a stale role cookie.
  jar.delete("od-role")
  jar.delete("od-tenant")
  jar.delete("od-device")
  redirect("/sign-in")
}
