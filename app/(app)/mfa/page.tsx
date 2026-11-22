import { redirect } from "next/navigation"

import { MfaGate } from "@/features/account"
import { needsMfaPrompt } from "@/lib/mfa"
import { getSession } from "@/lib/session"

// Two things live here. (1) Where requireMfaOk() sends a caller whose second factor is outstanding (strict mode, or a code step): the (app) layout renders the gate
// (MfaGate or MfaStepUp) here instead of this page. (2) The soft set-up card (prompt mode, the default): the banner's "Set up now" opens it, nothing is refused, and it
// has a Back. Once the code is verified this page sends the visitor home. This page must NOT call requireMfaOk (no loop).
export default async function Page() {
  const session = await getSession()
  if (session.mfa === "ok" && needsMfaPrompt(session.mfaPolicy, session.role.id, session.twoFactorEnabled)) {
    return <MfaGate soft account={session.user.email} who={session.role.id === "owner" ? "owner" : "member"} />
  }
  if (session.mfa === "ok") redirect("/")
  return null
}
