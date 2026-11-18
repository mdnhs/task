"use client"

import { useState } from "react"
import Link from "next/link"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { LiveTenantRow } from "../adapters"
import { GRANT_HOURS_MAX, REASON_MAX } from "../client"
import { dateTimeUtc } from "../format"
import { usePlatform } from "./use-platform"

type Grant = { id: string; tenantId: string; expiresAt: string; revokedAt: string | null }

/**
 * Read-only support access for the CALLER (B6 T6.8): a reason (1 to 500) and hours (1 to 24). The API has no list route for staff, so the grants made in this visit show below with Revoke;
 * the tenant's owners see every grant (and can revoke it) under Settings, Support access (/settings/support-access), and are told at once.
 */
export function GrantForm({ tenants, tenantId: fixed, initial }: { tenants: { id: string; name: string }[]; tenantId?: string; initial?: string }) {
  const { client, act } = usePlatform()
  const [tenantId, setTenantId] = useState(fixed ?? (tenants.some((t) => t.id === initial) ? initial! : tenants[0]?.id ?? ""))
  const [reason, setReason] = useState("")
  const [hours, setHours] = useState("2")
  const [grants, setGrants] = useState<Grant[]>([])
  const name = (id: string) => tenants.find((t) => t.id === id)?.name ?? id

  async function create() {
    const r = await act(`grant:${tenantId}`, () => client.createGrant(tenantId, reason, Number(hours)), "Support access granted")
    if (r.ok) {
      const g = r.value
      setGrants((l) => [{ id: g.id, tenantId: g.tenantId, expiresAt: g.expiresAt, revokedAt: g.revokedAt }, ...l])
      setReason("")
    }
  }
  async function revoke(g: Grant) {
    const r = await act(`revoke:${g.id}`, () => client.revokeGrant(g.id), "Access revoked")
    if (r.ok) setGrants((l) => l.map((x) => (x.id === g.id ? { ...x, revokedAt: r.value.revokedAt } : x)))
  }

  return (
    <div className="card pf-card">
      <div className="card-head"><div><h2>Request access</h2><div className="sub">Read only, for you, up to {GRANT_HOURS_MAX} hours. Tenant owners are told.</div></div></div>
      <form className="pf-form" onSubmit={(e) => { e.preventDefault(); void create() }}>
        {!fixed && <FilterSelect label="Tenant" value={tenantId} options={tenants.map((t) => ({ value: t.id, label: t.name }))} onChange={setTenantId} />}
        <Field label="Reason" htmlFor="pf-grant-reason" hint={`Up to ${REASON_MAX} characters`} required>
          <Textarea id="pf-grant-reason" value={reason} rows={2} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Hours" htmlFor="pf-grant-hours" hint={`1 to ${GRANT_HOURS_MAX}`} required>
          <Input id="pf-grant-hours" type="number" inputMode="numeric" min={1} max={GRANT_HOURS_MAX} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={!tenantId || reason.trim() === ""}><Icon name="shield" />Grant access</button>
      </form>
      {grants.length > 0 && (
        <ul className="pf-modlist">
          {grants.map((g) => (
            <li key={g.id}>
              <div className="pf-modlist-main">
                <span className="tt">{name(g.tenantId)}</span>
                <span className="pf-modlist-d">{g.revokedAt ? "Revoked" : `Until ${dateTimeUtc(g.expiresAt)}`}</span>
              </div>
              {!g.revokedAt && <button type="button" className="btn btn-outline pf-act" onClick={() => void revoke(g)}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LiveSupport({ tenants, requestFor }: { tenants: LiveTenantRow[]; requestFor?: string }) {
  return (
    <>
      <PageHead title="Support access" subtitle="Time-limited, read-only access to a tenant, with a reason" />
      <GrantForm tenants={tenants.filter((t) => t.status !== "suspended")} initial={requestFor} />
      <p className="pf-note">
        Each grant also shows on the tenant&apos;s own <Link href="/settings/support-access">Settings, support-access</Link> page, where its owners can revoke it. Hours, reason and who asked are in the audit log.
      </p>
    </>
  )
}
