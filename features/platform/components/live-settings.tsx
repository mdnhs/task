"use client"

import { useRef, useState } from "react"

import { useSlideDir } from "@/components/data-pagination"
import { Field } from "@/components/field"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StretchIndicator } from "@/components/stretch-indicator"
import { SecretInput } from "@/components/secret-input"
import { Input } from "@/components/ui/input"
import type { LiveBilling, LiveEmail, LiveStorage } from "../adapters"
import { dateTimeUtc } from "../format"
import { nextSection, SETTINGS_SECTIONS, sectionHref } from "../settings-sections"
import type { SettingsSection } from "../settings-sections"
import { usePlatform } from "./use-platform"

// A secret field is write-only (B6 T6.8): the API never sends a secret back, only its last 4, so the form starts empty and an empty value keeps the stored one.
const hint = (configured: boolean, h?: string) => (configured ? `Stored: ${h}. Leave empty to keep it.` : "Not set")

/** Platform settings (owner only, the API's settings routes): email (Resend), file storage (R2) and billing (Stripe). Test buttons show the API's ok / failed answer. */
export function LiveSettings({ email, storage, billing, canWrite, section: initial = "email" }: { email: LiveEmail; storage: LiveStorage; billing: LiveBilling; canWrite: boolean; section?: SettingsSection }) {
  const { client, act } = usePlatform()
  const [e, setE] = useState({ apiKey: "", fromAddress: email.configured ? email.fromAddress : "", fromName: email.configured ? email.fromName : "", to: "" })
  const [s, setS] = useState({ accountId: storage.configured ? storage.accountId : "", bucket: storage.configured ? storage.bucket : "", accessKeyId: storage.configured ? storage.accessKeyId : "", secretAccessKey: "" })
  const [b, setB] = useState({ secretKey: "", webhookSecret: "", publishableKey: billing.configured ? billing.publishableKey ?? "" : "" })
  const [tested, setTested] = useState<{ email?: string; storage?: string }>({})

  async function test(kind: "email" | "storage") {
    const r = await act(`test:${kind}`, () => (kind === "email" ? client.testEmail(e.to) : client.testStorage()), "Test finished")
    if (r.ok) setTested((t) => ({ ...t, [kind]: r.value.ok ? "ok" : `failed: ${r.value.error}` }))
  }
  const ro = !canWrite
  // Vertical tabs: every panel stays mounted (hidden when not selected), so typed values survive a tab switch. The URL (?section=) follows the selection without a server round-trip.
  const [section, setSection] = useState<SettingsSection>(initial)
  const dir = useSlideDir(SETTINGS_SECTIONS.findIndex((x) => x.id === section))
  const tabsRef = useRef<HTMLDivElement>(null)
  const status = { email: email.configured ? "Configured" : "Not set up", storage: storage.configured ? "Configured" : "Not set up", billing: billing.configured ? "Configured" : "Not set up" }
  const pick = (id: SettingsSection, focus = false) => {
    setSection(id)
    window.history.replaceState(null, "", sectionHref(window.location.pathname, id))
    if (focus) tabsRef.current?.querySelector<HTMLElement>(`#pf-tab-${id}`)?.focus()
  }
  const panel = (id: SettingsSection) => ({ id: `pf-panel-${id}`, role: "tabpanel" as const, "aria-labelledby": `pf-tab-${id}`, hidden: section !== id, className: "pf-set-panel od-slide", "data-slide": dir })

  return (
    <>
      <PageHead title="Settings" subtitle="Email, file storage and billing for the platform" />
      <div className="set-layout">
        <div className="set-tabs" role="tablist" aria-orientation="vertical" aria-label="Settings sections" ref={tabsRef}>
          <StretchIndicator active={section} axis="auto" selector={'[aria-selected="true"]'} className="set-tab-bg stretch-ind" />
          {SETTINGS_SECTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`pf-tab-${t.id}`}
              aria-selected={section === t.id}
              aria-controls={`pf-panel-${t.id}`}
              tabIndex={section === t.id ? 0 : -1}
              className="set-tab pf-tab"
              onClick={() => pick(t.id)}
              onKeyDown={(ev) => { const n = nextSection(section, ev.key); if (n) { ev.preventDefault(); pick(n, true) } }}
            >
              <Icon name={t.icon} />
              <span className="pf-tab-txt"><span>{t.label}</span><span className="pf-tab-st">{status[t.id]}</span></span>
            </button>
          ))}
        </div>
        <div className="set-body">
      <div {...panel("email")}><section className="card pf-card" aria-labelledby="pf-set-email">
        <div className="card-head"><div><h2 id="pf-set-email">Email</h2><div className="sub">{email.configured ? `Resend · updated ${dateTimeUtc(email.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form od-form pf-set" onSubmit={(ev) => { ev.preventDefault(); void act("save:email", () => client.saveEmail(e), "Email settings saved").then((r) => r.ok && setE((x) => ({ ...x, apiKey: "" }))) }}>
          <Field label="API key" htmlFor="pf-e-key" hint={hint(email.configured, email.configured ? email.keyHint : undefined)}><SecretInput id="pf-e-key" placeholder="re_…" autoComplete="off" value={e.apiKey} disabled={ro} onChange={(ev) => setE({ ...e, apiKey: ev.target.value })} /></Field>
          <Field label="From address" htmlFor="pf-e-from" required><Input id="pf-e-from" placeholder="noreply@example.com" type="email" value={e.fromAddress} disabled={ro} onChange={(ev) => setE({ ...e, fromAddress: ev.target.value })} /></Field>
          <Field label="From name" htmlFor="pf-e-name" required><Input id="pf-e-name" placeholder="Company name" value={e.fromName} disabled={ro} onChange={(ev) => setE({ ...e, fromName: ev.target.value })} /></Field>
          {canWrite && <div className="pf-set-acts"><button type="submit" className="btn btn-primary">Save email</button></div>}
        </form>
        {canWrite && (
          <div className="pf-form pf-set pf-set-test">
            <div className="pf-set-row">
              <Field label="Send test to" htmlFor="pf-e-to"><Input id="pf-e-to" type="email" value={e.to} placeholder="you@example.com" onChange={(ev) => setE({ ...e, to: ev.target.value })} /></Field>
              <button type="button" className="btn btn-outline" disabled={e.to.trim() === "" || !email.configured} onClick={() => void test("email")}>Send test</button>
            </div>
            {tested.email && <span className={`st ${tested.email === "ok" ? "ok" : "bad"}`} role="status">{tested.email}</span>}
          </div>
        )}
      </section></div>

      <div {...panel("storage")}><section className="card pf-card" aria-labelledby="pf-set-storage">
        <div className="card-head"><div><h2 id="pf-set-storage">File storage</h2><div className="sub">{storage.configured ? `R2 · updated ${dateTimeUtc(storage.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form od-form pf-set" onSubmit={(ev) => { ev.preventDefault(); void act("save:storage", () => client.saveStorage(s), "Storage settings saved").then((r) => r.ok && setS((x) => ({ ...x, secretAccessKey: "" }))) }}>
          <Field label="Account ID" htmlFor="pf-s-acc" required><Input id="pf-s-acc" placeholder="Cloudflare account ID" value={s.accountId} disabled={ro} onChange={(ev) => setS({ ...s, accountId: ev.target.value })} /></Field>
          <Field label="Bucket" htmlFor="pf-s-bucket" required><Input id="pf-s-bucket" placeholder="bucket-name" value={s.bucket} disabled={ro} onChange={(ev) => setS({ ...s, bucket: ev.target.value })} /></Field>
          <Field label="Access key ID" htmlFor="pf-s-key" required><Input id="pf-s-key" placeholder="Access key ID" value={s.accessKeyId} disabled={ro} onChange={(ev) => setS({ ...s, accessKeyId: ev.target.value })} /></Field>
          <Field label="Secret access key" htmlFor="pf-s-secret" hint={hint(storage.configured, storage.configured ? storage.secretHint : undefined)}><SecretInput id="pf-s-secret" placeholder="Secret access key" autoComplete="off" value={s.secretAccessKey} disabled={ro} onChange={(ev) => setS({ ...s, secretAccessKey: ev.target.value })} /></Field>
          {canWrite && (
            <>
              <div className="pf-set-acts">
                <button type="submit" className="btn btn-primary">Save storage</button>
                <button type="button" className="btn btn-outline" disabled={!storage.configured} title={storage.configured ? undefined : "Save the storage settings first"} onClick={() => void test("storage")}>Test storage</button>
                {tested.storage && <span className={`st ${tested.storage === "ok" ? "ok" : "bad"}`} role="status">{tested.storage}</span>}
              </div>
              {!storage.configured && <p className="od-field-hint">Save the storage settings first to enable the test.</p>}
            </>
          )}
        </form>
      </section></div>

      <div {...panel("billing")}><section className="card pf-card" aria-labelledby="pf-set-billing">
        <div className="card-head"><div><h2 id="pf-set-billing">Billing</h2><div className="sub">{billing.configured ? `Stripe · updated ${dateTimeUtc(billing.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form od-form pf-set" onSubmit={(ev) => { ev.preventDefault(); void act("save:billing", () => client.saveBilling(b), "Billing settings saved").then((r) => r.ok && setB((x) => ({ ...x, secretKey: "", webhookSecret: "" }))) }}>
          <Field label="Secret key" htmlFor="pf-b-sk" hint={hint(billing.configured, billing.configured ? billing.secretHint : undefined)}><SecretInput id="pf-b-sk" placeholder="Secret key" autoComplete="off" value={b.secretKey} disabled={ro} onChange={(ev) => setB({ ...b, secretKey: ev.target.value })} /></Field>
          <Field label="Webhook secret" htmlFor="pf-b-wh" hint={hint(billing.configured, billing.configured ? billing.webhookHint : undefined)}><SecretInput id="pf-b-wh" placeholder="Signing secret" autoComplete="off" value={b.webhookSecret} disabled={ro} onChange={(ev) => setB({ ...b, webhookSecret: ev.target.value })} /></Field>
          <Field label="Publishable key" htmlFor="pf-b-pk" hint="pk_test_… or pk_live_…: sets the Test / Live pill"><Input id="pf-b-pk" value={b.publishableKey} disabled={ro} onChange={(ev) => setB({ ...b, publishableKey: ev.target.value })} /></Field>
          {billing.configured && <p className="pf-note pf-note-info">Webhook URL: <span className="num">{billing.webhookUrl}</span></p>}
          {canWrite && <div className="pf-set-acts"><button type="submit" className="btn btn-primary">Save billing</button></div>}
        </form>
      </section></div>
        </div>
      </div>
    </>
  )
}
