"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"

import { signOutAction } from "@/app/actions/session"
import { Icon } from "@/components/icon"
import { clearClientStores } from "@/lib/client-stores"
import { mfaGateCopy, type GateAudience } from "@/lib/mfa-gate"
import { TotpSetup } from "./totp-setup"

// AC-M0-02: shown instead of the page while the workspace requires two-step verification and this person has not set it up.
// The shell around it (sidebar, account menu) keeps working; the API still refuses tenant data until the first code verifies.
// `onSkip` exists only where a grace period applies (lib/mfa-gate.ts); the caller passes it then, never otherwise.
export function MfaGate({ account, who, onSkip }: { account: string; who: GateAudience; onSkip?: () => void }) {
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
        {onSkip && <button type="button" className="btn btn-outline set-sm" onClick={onSkip}>Skip for now</button>}
        <button
          type="button"
          className="auth-link"
          disabled={signingOut}
          onClick={() => startSignOut(() => { clearClientStores("sign_out"); return signOutAction() })}
        >
          <Icon name="logout" size={24} /> Sign out
        </button>
      </div>
    </section>
  )
}
