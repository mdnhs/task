"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { signOutAction } from "@/app/actions/session"
import { Icon } from "@/components/icon"
import { clearClientStores } from "@/lib/client-stores"
import { mfaGateCopy, type GateAudience } from "@/lib/mfa-gate"
import { mfaReturnTarget } from "@/lib/mfa-stepper"
import { runSignOut } from "@/lib/sign-out-client"
import { TotpSetup } from "./totp-setup"

// AC-M0-02: the two-step set-up card. `soft` (prompt mode, the default): nothing is refused, so Cancel simply leaves, back to where the person was (`?next=`, checked),
// and nothing is turned on until they enter their password and continue. Strict mode (the API refuses everything): the only way out is Sign out, which is the Cancel of every step.
// After the last step the page they originally wanted (`?next=`) opens; the shell around the card (sidebar, account menu) keeps working.
export function MfaGate({ account, who, soft = false }: { account: string; who: GateAudience; soft?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const nextParam = useSearchParams().get("next")
  const [, startSignOut] = useTransition()
  const copy = mfaGateCopy(who)
  // Where to go after set-up or Cancel: the checked `next`; on /mfa itself without one, home; on any other page (the strict gate renders in place) stay.
  const target = nextParam !== null ? mfaReturnTarget(nextParam) : pathname === "/mfa" ? "/" : null

  function leave() {
    if (target) router.replace(target)
    else if (window.history.length > 1) router.back()
    else router.push("/")
  }
  function done() {
    // This session is MFA-passed now: go to the page they wanted, then re-read the layout (session, banner) for that URL.
    if (target) router.replace(target)
    router.refresh()
  }
  const signOut = () => startSignOut(() => runSignOut({ clear: () => clearClientStores("sign_out"), action: signOutAction, assign: (to) => window.location.assign(to) }))

  return (
    <section className="card set-card mfa-gate" aria-labelledby="mfa-gate-h">
      <div className="card-head">
        <div>
          <h1 id="mfa-gate-h" className="mfa-gate-h"><Icon name="lock" /> Set up two-step verification</h1>
          <div className="sub">{copy.reason}</div>
        </div>
      </div>
      <p className="mfa-gate-effort"><Icon name="clock" size={24} /> {copy.effort}</p>
      <TotpSetup account={account} onDone={done} onCancel={soft ? leave : signOut} cancelLabel={soft ? "Cancel" : "Sign out"} />
    </section>
  )
}
