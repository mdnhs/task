"use client"

import { useState } from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { Monitor } from "lucide-react"
import { toast } from "sonner"

import { disableMfa } from "@/app/actions/security"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { Icon } from "@/components/icons"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { When } from "@/components/when"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { nowInTz } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { ACTIVITY_PAGE_SIZE } from "../constants"
import { securityStore } from "../store"
import type { SecurityData } from "../types"
import { TotpSetup } from "./totp-setup"

// Security (FR-AUTH-04/05/06): verified password reset, MFA, active sessions. Every action lands in the activity list and a toast.
export function SecurityPanel({
  data,
  email,
  today,
  timezone,
  tzLabel,
  scopeKey,
  mfaRequired = false,
}: {
  data: SecurityData
  email: string
  today: string
  timezone: string
  tzLabel: string
  scopeKey: string
  /** The workspace requires two-step verification for this person (FR-M0-04): it cannot be switched off. */
  mfaRequired?: boolean
}) {
  const [state, setState] = securityStore.useStore({ mfa: data.mfa, sessions: data.sessions, activity: data.activity }, scopeKey)
  const [resetOpen, setResetOpen] = useState(false)
  const [mfaNext, setMfaNext] = useState<boolean | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [signOutAll, setSignOutAll] = useState(false)
  const [page, setPage] = useState(1)

  const log = (text: string) => setState((p) => ({ ...p, activity: [{ id: `a${Date.now()}`, text, at: nowInTz(today, timezone) }, ...p.activity] }))
  const others = state.sessions.filter((s) => !s.current)
  const paged = paginate(state.activity, page, ACTIVITY_PAGE_SIZE)

  function sendReset() {
    log("Password reset link emailed")
    toast.success("Reset link sent", { description: `Check ${email}` })
    setResetOpen(true)
  }
  async function applyMfa() {
    if (mfaNext !== false) return
    const r = await disableMfa()
    if (!r.ok) return toast.error("Two-step verification is required for your role")
    setState((p) => ({ ...p, mfa: false }))
    log("Two-step verification turned off")
    toast.success("Two-step verification off")
  }
  function signOutOne(id: string) {
    const s = state.sessions.find((x) => x.id === id)
    if (!s) return
    setState((p) => ({ ...p, sessions: p.sessions.filter((x) => x.id !== id) }))
    log(`Signed out ${s.device}`)
    toast.success("Session signed out", { description: s.device })
  }
  function signOutOthers() {
    setState((p) => ({ ...p, sessions: p.sessions.filter((x) => x.current) }))
    log(`Signed out of ${others.length} other ${others.length === 1 ? "session" : "sessions"}`)
    toast.success("Signed out of other sessions")
  }

  return (
    <>
      <section className="card set-card" aria-labelledby="acc-pw-h">
        <div className="card-head">
          <div>
            <h2 id="acc-pw-h">Password</h2>
            <div className="sub">We email a verified reset link, so the new password is never typed here</div>
          </div>
          <button type="button" className="btn btn-outline set-sm" onClick={sendReset}>Change password</button>
        </div>
        <label className="set-switch-row acc-mfa">
          <Switch
            checked={state.mfa}
            aria-label="Two-step verification"
            disabled={mfaRequired && state.mfa}
            onCheckedChange={(on) => (on ? setSetupOpen(true) : setMfaNext(false))}
          />
          <span className="acc-mfa-text">
            <span>Two-step verification</span>
            <span className="tm">{state.mfa ? (mfaRequired ? "On: required by your workspace administrator" : "On: a code is asked at every new sign-in") : "Off: add a code step to protect your account"}</span>
          </span>
        </label>
      </section>

      <section className="card set-card" aria-labelledby="acc-sess-h">
        <div className="card-head">
          <div>
            <h2 id="acc-sess-h">Active sessions</h2>
            <div className="sub">{state.sessions.length} signed in</div>
          </div>
          <button type="button" className="btn btn-outline set-sm" disabled={others.length === 0} onClick={() => setSignOutAll(true)}>
            Sign out of all other sessions
          </button>
        </div>
        <ul className="set-list">
          {state.sessions.map((s) => (
            <li key={s.id} className="acc-sess">
              <span className="acc-sess-ico">{s.kind === "phone" ? <Icon name="phone" /> : <Monitor className="ico" strokeWidth={1.8} aria-hidden="true" />}</span>
              <div className="acc-sess-main">
                <span className="acc-sess-top">
                  <b>{s.device}</b>
                  {s.current && <span className="st ok">This device</span>}
                </span>
                <span className="tm">
                  {s.location} · <When iso={s.lastActive} today={today} tzLabel={tzLabel} />
                </span>
              </div>
              {!s.current && (
                <button type="button" className="btn btn-outline set-sm" onClick={() => signOutOne(s.id)} aria-label={`Sign out ${s.device}`}>
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card set-card" aria-labelledby="acc-act-h">
        <div className="card-head">
          <div>
            <h2 id="acc-act-h">Security activity</h2>
            <div className="sub">Recent sign-in and security events on your account</div>
          </div>
        </div>
        <ul className="set-list">
          {paged.rows.map((a) => (
            <li key={a.id} className="acc-act">
              <span className="acc-act-text">{a.text}</span>
              <span className="tm"><When iso={a.at} today={today} tzLabel={tzLabel} /></span>
            </li>
          ))}
        </ul>
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Security activity pages" onPageChange={setPage} />
      </section>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="od-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset link sent</AlertDialogTitle>
            <AlertDialogDescription>
              We emailed a password reset link to {email}. Open it to choose a new password. The link expires in {data.resetLinkMinutes} minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogPrimitive.Close render={<button type="button" className="btn btn-primary" />}>Done</AlertDialogPrimitive.Close>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="od-dialog od-form-dialog">
          <DialogHeader>
            <DialogTitle>Set up two-step verification</DialogTitle>
            <DialogDescription>Add this account to an authenticator app, then confirm with a code.</DialogDescription>
          </DialogHeader>
          <TotpSetup
            account={email}
            onDone={() => {
              setSetupOpen(false)
              setState((p) => ({ ...p, mfa: true }))
              log("Two-step verification turned on")
            }}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={mfaNext !== null}
        onOpenChange={(o) => !o && setMfaNext(null)}
        title="Turn off two-step verification?"
        text="Your account will be protected by your password alone. We recommend keeping it on."
        confirmLabel="Turn off"
        destructive
        onConfirm={applyMfa}
      />
      <ConfirmDialog
        open={signOutAll}
        onOpenChange={setSignOutAll}
        title="Sign out of all other sessions?"
        text={`${others.length} other ${others.length === 1 ? "device is" : "devices are"} signed out straight away. This device stays signed in.`}
        confirmLabel="Sign out others"
        destructive
        onConfirm={signOutOthers}
      />
    </>
  )
}
