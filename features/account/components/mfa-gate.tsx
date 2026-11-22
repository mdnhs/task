"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { signOutAction } from "@/app/actions/session"
import { Icon } from "@/components/icon"
import { clearClientStores } from "@/lib/client-stores"
import { runSignOut } from "@/lib/sign-out-client"
import { mfaGateCopy, type GateAudience } from "@/lib/mfa-gate"
import { TotpSetup } from "./totp-setup"

// AC-M0-02: shown instead of the page while the workspace requires two-step verification and this person has not set it up.
// The shell around it (sidebar, account menu) keeps working; the API still refuses tenant data until the first code verifies.
// `soft` (prompt mode, the default): nothing is refused, so the card has a Back to the previous page; nothing is turned on until the person enters their password
// and continues. Strict mode (the API refuses everything) has no Back: Sign out is the only way out.
export function MfaGate({ account, who, soft = false }: { account: string; who: GateAudience; soft?: boolean }) {
  const router = useRouter()
  const [signingOut, startSignOut] = useTransition()
  const copy = mfaGateCopy(who)
  return (
    <section className="card set-card mfa-gate" aria-labelledby="mfa-gate-h">
      <div className="card-head">
        <div>
          <h1 id="mfa-gate-h" className="mfa-gate-h"><Icon name="lock" /> Set up two-step verification</h1>
          <div className="sub">{copy.reason}</div>
        </div>
      </div>
      <p className="mfa-gate-effort"><Icon name="clock" size={24} /> {copy.effort}</p>
      {/* Once the first code verifies, this session is MFA-passed: reload so the layout lets the workspace in. */}
      <TotpSetup account={account} onDone={() => router.refresh()} />
      <div className="mfa-gate-foot">
        {soft && <button type="button" className="btn btn-outline set-sm" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}><Icon name="chevron-left" size={24} /> Back</button>}
        <button
          type="button"
          className="auth-link"
          disabled={signingOut}
          onClick={() => startSignOut(() => runSignOut({ clear: () => clearClientStores("sign_out"), action: signOutAction, assign: (to) => window.location.assign(to) }))}
        >
          <Icon name="logout" size={24} /> Sign out
        </button>
      </div>
    </section>
  )
}
