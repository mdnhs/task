import { redirect } from "next/navigation"

import { getSession } from "@/lib/session"

// Where requireMfaOk() sends a caller whose second factor is outstanding. The (app) layout renders the gate (MfaGate or MfaStepUp) here instead of this
// page. Once the code is verified the layout refreshes into this page, which sends the visitor home. This page must NOT call requireMfaOk (no loop).
export default async function Page() {
  const session = await getSession()
  if (session.mfa === "ok") redirect("/")
  return null
}
