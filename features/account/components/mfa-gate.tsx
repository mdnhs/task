"use client"

import { useRouter } from "next/navigation"

import { Icon } from "@/components/icon"
import { TotpSetup } from "./totp-setup"

// AC-M0-02: shown instead of every page while the workspace requires two-step verification and this person has not set it up.
export function MfaGate({ account }: { account: string }) {
  const router = useRouter()
  return (
    <section className="card set-card mfa-gate" aria-labelledby="mfa-gate-h">
      <div className="card-head">
        <div>
          <h1 id="mfa-gate-h" className="mfa-gate-h"><Icon name="lock" /> Set up two-step verification</h1>
          <div className="sub">Your workspace administrator requires a code step at sign-in. Set it up to continue.</div>
        </div>
      </div>
      {/* Once the first code verifies, this session is MFA-passed: reload so the layout lets the workspace in. */}
      <TotpSetup account={account} onDone={() => router.refresh()} />
    </section>
  )
}
