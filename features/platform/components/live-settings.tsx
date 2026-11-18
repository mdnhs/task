"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { PageHead } from "@/components/page-head"
import { Input } from "@/components/ui/input"
import type { LiveBilling, LiveEmail, LiveStorage } from "../adapters"
import { dateTimeUtc } from "../format"
import { usePlatform } from "./use-platform"

// A secret field is write-only (B6 T6.8): the API never sends a secret back, only its last 4, so the form starts empty and an empty value keeps the stored one.
const hint = (configured: boolean, h?: string) => (configured ? `Stored: ${h}. Leave empty to keep it.` : "Not set")

/** Platform settings (owner only, the API's settings routes): email (Resend), file storage (R2) and billing (Stripe). Test buttons show the API's ok / failed answer. */
export function LiveSettings({ email, storage, billing, canWrite }: { email: LiveEmail; storage: LiveStorage; billing: LiveBilling; canWrite: boolean }) {
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

  return (
    <>
      <PageHead title="Settings" subtitle="Email, file storage and billing for the platform" />
      <section className="card pf-card" aria-labelledby="pf-set-email">
        <div className="card-head"><div><h2 id="pf-set-email">Email</h2><div className="sub">{email.configured ? `Resend · updated ${dateTimeUtc(email.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form" onSubmit={(ev) => { ev.preventDefault(); void act("save:email", () => client.saveEmail(e), "Email settings saved").then((r) => r.ok && setE((x) => ({ ...x, apiKey: "" }))) }}>
          <Field label="API key" htmlFor="pf-e-key" hint={hint(email.configured, email.configured ? email.keyHint : undefined)}><Input id="pf-e-key" type="password" autoComplete="off" value={e.apiKey} disabled={ro} onChange={(ev) => setE({ ...e, apiKey: ev.target.value })} /></Field>
          <Field label="From address" htmlFor="pf-e-from" required><Input id="pf-e-from" type="email" value={e.fromAddress} disabled={ro} onChange={(ev) => setE({ ...e, fromAddress: ev.target.value })} /></Field>
          <Field label="From name" htmlFor="pf-e-name" required><Input id="pf-e-name" value={e.fromName} disabled={ro} onChange={(ev) => setE({ ...e, fromName: ev.target.value })} /></Field>
          {canWrite && <button type="submit" className="btn btn-primary">Save email</button>}
        </form>
        {canWrite && (
          <div className="pf-form">
            <Field label="Send test to" htmlFor="pf-e-to"><Input id="pf-e-to" type="email" value={e.to} onChange={(ev) => setE({ ...e, to: ev.target.value })} /></Field>
            <button type="button" className="btn btn-outline" disabled={e.to.trim() === "" || !email.configured} onClick={() => void test("email")}>Send test</button>
            {tested.email && <span className={`st ${tested.email === "ok" ? "ok" : "bad"}`} role="status">{tested.email}</span>}
          </div>
        )}
      </section>

      <section className="card pf-card" aria-labelledby="pf-set-storage">
        <div className="card-head"><div><h2 id="pf-set-storage">File storage</h2><div className="sub">{storage.configured ? `R2 · updated ${dateTimeUtc(storage.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form" onSubmit={(ev) => { ev.preventDefault(); void act("save:storage", () => client.saveStorage(s), "Storage settings saved").then((r) => r.ok && setS((x) => ({ ...x, secretAccessKey: "" }))) }}>
          <Field label="Account ID" htmlFor="pf-s-acc" required><Input id="pf-s-acc" value={s.accountId} disabled={ro} onChange={(ev) => setS({ ...s, accountId: ev.target.value })} /></Field>
          <Field label="Bucket" htmlFor="pf-s-bucket" required><Input id="pf-s-bucket" value={s.bucket} disabled={ro} onChange={(ev) => setS({ ...s, bucket: ev.target.value })} /></Field>
          <Field label="Access key ID" htmlFor="pf-s-key" required><Input id="pf-s-key" value={s.accessKeyId} disabled={ro} onChange={(ev) => setS({ ...s, accessKeyId: ev.target.value })} /></Field>
          <Field label="Secret access key" htmlFor="pf-s-secret" hint={hint(storage.configured, storage.configured ? storage.secretHint : undefined)}><Input id="pf-s-secret" type="password" autoComplete="off" value={s.secretAccessKey} disabled={ro} onChange={(ev) => setS({ ...s, secretAccessKey: ev.target.value })} /></Field>
          {canWrite && <button type="submit" className="btn btn-primary">Save storage</button>}
        </form>
        {canWrite && (
          <div className="pf-form">
            <button type="button" className="btn btn-outline" disabled={!storage.configured} onClick={() => void test("storage")}>Test storage</button>
            {tested.storage && <span className={`st ${tested.storage === "ok" ? "ok" : "bad"}`} role="status">{tested.storage}</span>}
          </div>
        )}
      </section>

      <section className="card pf-card" aria-labelledby="pf-set-billing">
        <div className="card-head"><div><h2 id="pf-set-billing">Billing</h2><div className="sub">{billing.configured ? `Stripe · updated ${dateTimeUtc(billing.updatedAt)}` : "Not set up"}</div></div></div>
        <form className="pf-form" onSubmit={(ev) => { ev.preventDefault(); void act("save:billing", () => client.saveBilling(b), "Billing settings saved").then((r) => r.ok && setB((x) => ({ ...x, secretKey: "", webhookSecret: "" }))) }}>
          <Field label="Secret key" htmlFor="pf-b-sk" hint={hint(billing.configured, billing.configured ? billing.secretHint : undefined)}><Input id="pf-b-sk" type="password" autoComplete="off" value={b.secretKey} disabled={ro} onChange={(ev) => setB({ ...b, secretKey: ev.target.value })} /></Field>
          <Field label="Webhook secret" htmlFor="pf-b-wh" hint={hint(billing.configured, billing.configured ? billing.webhookHint : undefined)}><Input id="pf-b-wh" type="password" autoComplete="off" value={b.webhookSecret} disabled={ro} onChange={(ev) => setB({ ...b, webhookSecret: ev.target.value })} /></Field>
          <Field label="Publishable key" htmlFor="pf-b-pk" hint="pk_test_… or pk_live_…: sets the Test / Live pill"><Input id="pf-b-pk" value={b.publishableKey} disabled={ro} onChange={(ev) => setB({ ...b, publishableKey: ev.target.value })} /></Field>
          {billing.configured && <p className="pf-note">Webhook URL: <span className="num">{billing.webhookUrl}</span></p>}
          {canWrite && <button type="submit" className="btn btn-primary">Save billing</button>}
        </form>
      </section>
    </>
  )
}
