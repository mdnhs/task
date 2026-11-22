"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { Field } from "@/components/field"
import { Icon } from "@/components/icon"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SecretInput } from "@/components/secret-input"
import { Switch } from "@/components/ui/switch"
import { When } from "@/components/when"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { userMessage } from "@/lib/api/problem"
import { apiBrowser } from "@/lib/api/browser"
import { disableTotp, requestPasswordReset, revokeOtherSessions } from "@/lib/auth-client"
import { paginate } from "@/lib/paginate"
import { ACTIVITY_PAGE_SIZE } from "../constants"
import type { OwnDevice, SecurityData } from "../types"
import { disableTotpFlow } from "../totp-flow"
import { ThisDevice } from "./this-device"
import { TotpSetup } from "./totp-setup"

// Security (FR-AUTH-04/05/06): verified password reset, MFA (Better Auth), active sessions (GET/DELETE /v1/me/sessions, no tokens, no locations).
// The page data is server-rendered; each action calls the API and refreshes the page. The activity list is the last five sign-ins.
export function SecurityPanel({
  data,
  email,
  today,
  tzLabel,
  mfaRequired = false,
  device,
  ownDevices,
}: {
  data: SecurityData
  email: string
  today: string
  tzLabel: string
  /** The workspace requires two-step verification for this person (FR-M0-04): it cannot be switched off. */
  mfaRequired?: boolean
  /** The device this browser is, as the API resolved it (the shell chip's source). */
  device: { label: string; registered: boolean }
  /** Devices allocated to this person (for "Enter code"). */
  ownDevices: OwnDevice[]
}) {
  const router = useRouter()
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [mfaOn, setMfaOn] = useState(data.mfa)
  const [resetOpen, setResetOpen] = useState(false)
  const [mfaNext, setMfaNext] = useState<boolean | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [disablePw, setDisablePw] = useState("")
  const [disableError, setDisableError] = useState<string>()
  const [signOutAll, setSignOutAll] = useState(false)
  const [page, setPage] = useState(1)
  const [pending, start] = useTransition()

  const sessions = data.sessions.filter((s) => !removed.has(s.id))
  const others = sessions.filter((s) => !s.current)
  const paged = paginate(data.activity, page, ACTIVITY_PAGE_SIZE)

  function sendReset() {
    start(async () => {
      try {
        await requestPasswordReset(email, "/reset-password")
        toast.success("Reset link sent", { description: `Check ${email}` })
        setResetOpen(true)
      } catch (e) {
        toast.error(userMessage(e).text)
      }
    })
  }
  function applyMfaOff() {
    start(async () => {
      const r = await disableTotpFlow(disableTotp, disablePw)
      setDisablePw("")
      if (!r.ok) return setDisableError(r.message)
      setDisableError(undefined)
      setMfaNext(null)
      setMfaOn(false)
      toast.success("Two-step verification off")
      router.refresh()
    })
  }
  function signOutOne(id: string, device: string) {
    start(async () => {
      try {
        await apiBrowser.delete("/v1/me/sessions/{id}", { path: { id } })
        setRemoved((p) => new Set(p).add(id))
        toast.success("Session signed out", { description: device })
        router.refresh()
      } catch (e) {
        toast.error(userMessage(e).text)
      }
    })
  }
  function signOutOthers() {
    start(async () => {
      try {
        await revokeOtherSessions()
        setRemoved(new Set(others.map((x) => x.id)))
        toast.success("Signed out of other sessions")
        router.refresh()
      } catch (e) {
        toast.error(userMessage(e).text)
      }
    })
  }

  return (
    <>
      <section className="card set-card" aria-labelledby="acc-pw-h">
        <div className="card-head">
          <div>
            <h2 id="acc-pw-h">Password</h2>
            <div className="sub">We email a verified reset link, so the new password is never typed here</div>
          </div>
          <button type="button" className="btn btn-outline set-sm" disabled={pending} onClick={sendReset}>Change password</button>
        </div>
        <label className="set-switch-row acc-mfa">
          <Switch
            checked={mfaOn}
            aria-label="Two-step verification"
            disabled={mfaRequired && mfaOn}
            onCheckedChange={(on) => (on ? setSetupOpen(true) : setMfaNext(false))}
          />
          <span className="acc-mfa-text">
            <span>Two-step verification</span>
            <span className="tm">{mfaOn ? (mfaRequired ? "On: required by your workspace administrator" : "On: a code is asked at every new sign-in") : "Off: add a code step to protect your account"}</span>
          </span>
        </label>
      </section>

      <ThisDevice label={device.label} registered={device.registered} devices={ownDevices} />

      <section className="card set-card" aria-labelledby="acc-sess-h">
        <div className="card-head">
          <div>
            <h2 id="acc-sess-h">Active sessions</h2>
            <div className="sub">{sessions.length} signed in</div>
          </div>
          <button type="button" className="btn btn-outline set-sm" disabled={others.length === 0 || pending} onClick={() => setSignOutAll(true)}>
            Sign out of all other sessions
          </button>
        </div>
        <ul className="set-list">
          {sessions.map((s) => (
            <li key={s.id} className="acc-sess">
              <span className="acc-sess-ico">{s.kind === "phone" ? <Icon name="phone" /> : <Icon name="monitor" strokeWidth={1.8} />}</span>
              <div className="acc-sess-main">
                <span className="acc-sess-top">
                  <b>{s.device}</b>
                  {s.current && <span className="st ok">This device</span>}
                </span>
                <span className="tm"><When iso={s.lastActive} today={today} tzLabel={tzLabel} /></span>
              </div>
              {!s.current && (
                <button type="button" className="btn btn-outline set-sm" disabled={pending} onClick={() => signOutOne(s.id, s.device)} aria-label={`Sign out ${s.device}`}>
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
            onCancel={() => setSetupOpen(false)}
            onDone={() => {
              setSetupOpen(false)
              setMfaOn(true)
              router.refresh()
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={mfaNext !== null} onOpenChange={(o) => { if (!o) { setMfaNext(null); setDisablePw(""); setDisableError(undefined) } }}>
        <DialogContent className="od-dialog od-form-dialog">
          <DialogHeader>
            <DialogTitle>Turn off two-step verification?</DialogTitle>
            <DialogDescription>Your account will be protected by your password alone. We recommend keeping it on. Confirm your password to turn it off.</DialogDescription>
          </DialogHeader>
          <form className="mfa-steps" onSubmit={(e) => { e.preventDefault(); applyMfaOff() }} noValidate>
            <Field label="Password" htmlFor="mfa-off-pw" error={disableError} required>
              <SecretInput noun="password" id="mfa-off-pw" autoComplete="current-password" value={disablePw} onChange={(e) => { setDisablePw(e.target.value); setDisableError(undefined) }} />
            </Field>
            <div><button type="submit" className="btn btn-danger" disabled={pending}>Turn off</button></div>
          </form>
        </DialogContent>
      </Dialog>
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
