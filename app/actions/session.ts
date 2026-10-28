"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

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

export async function signIn(roleId?: string) {
  const { roles } = await getSession()
  const role = typeof roleId === "string" && roles.some((r) => r.id === roleId) ? roleId : undefined
  const jar = await cookies()
  jar.delete("od-auth")
  if (role) jar.set("od-role", role, opts)
  redirect(role === "platform" ? "/platform" : "/")
}

// Mock persistence for tenant branding (FR-SAAS-11): a per-tenant cookie that getSession() merges over the seed.
export async function saveBranding(input: { name: string; color: string }) {
  const session = await getSession()
  if (!canWrite(session, "settings")) return { ok: false as const }
  const name = input.name.trim().slice(0, 60)
  const color = input.color.toLowerCase()
  if (name.length < 2 || !/^#[0-9a-f]{6}$/.test(color)) return { ok: false as const }
  const jar = await cookies()
  jar.set(`od-brand-${session.tenant.id}`, JSON.stringify({ name, color }), opts)
  revalidatePath("/", "layout")
  return { ok: true as const }
}

export async function signOut() {
  const jar = await cookies()
  jar.set("od-auth", "out", opts)
  // Drop the role and company too, so nothing (e.g. the platform console) keeps working off a stale role cookie.
  jar.delete("od-role")
  jar.delete("od-tenant")
  redirect("/sign-in")
}
