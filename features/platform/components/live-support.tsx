"use client"

import { useState } from "react"
import Link from "next/link"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { LiveGrant, LiveTenantRow } from "../adapters"
import { GRANT_HOURS_MAX, REASON_MAX } from "../client"
import { dateTimeUtc } from "../format"
import { usePlatform } from "./use-platform"

type Grant = Pick<LiveGrant, "id" | "tenantId" | "expiresAt" | "revokedAt"> & Partial<Pick<LiveGrant, "tenantName" | "status" | "staffName" | "canRevoke">>

/**
 * Read-only support access for the CALLER (B6 T6.8): a reason (1 to 500) and hours (1 to 24). `grants` is the newest 50 from GET /v1/platform/support-grants (any status, any tenant), with Revoke only where the API says the caller may (`canRevoke`: platform owner, or the grantee's own); the API stays the authority; a grant made here is added to the top.
 * The tenant's owners see every grant (and can revoke it) under Settings, Support access (/settings/support-access), and are told at once.
 */
export function GrantForm({ tenants, tenantId: fixed, initial, grants: initialGrants = [] }: { tenants: { id: string; name: string }[]; tenantId?: string; initial?: string; grants?: Grant[] }) {
  const { client, act } = usePlatform()
  const [tenantId, setTenantId] = useState(fixed ?? (tenants.some((t) => t.id === initial) ? initial! : tenants[0]?.id ?? ""))
  const [reason, setReason] = useState("")
  const [hours, setHours] = useState("2")
  const [grants, setGrants] = useState<Grant[]>(initialGrants)
  const name = (g: Grant) => g.tenantName ?? tenants.find((t) => t.id === g.tenantId)?.name ?? g.tenantId

  async function create() {
    const r = await act(`grant:${tenantId}`, () => client.createGrant(tenantId, reason, Number(hours)), "Support access granted")
    if (r.ok) {
      const g = r.value
      setGrants((l) => [{ id: g.id, tenantId: g.tenantId, expiresAt: g.expiresAt, revokedAt: g.revokedAt, status: g.status, canRevoke: true }, ...l]) // a grant made here is the caller's own
      setReason("")
    }
  }
  async function revoke(g: Grant) {
    const r = await act(`revoke:${g.id}`, () => client.revokeGrant(g.id), "Access revoked")
    if (r.ok) setGrants((l) => l.map((x) => (x.id === g.id ? { ...x, revokedAt: r.value.revokedAt, status: "revoked" as const, canRevoke: false } : x)))
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
                <span className="tt">{name(g)}</span>
                <span className="pf-modlist-d">{g.revokedAt ? "Revoked" : g.status === "expired" ? `Expired ${dateTimeUtc(g.expiresAt)}` : `Until ${dateTimeUtc(g.expiresAt)}`}{g.staffName ? ` · ${g.staffName}` : ""}</span>
              </div>
              {g.canRevoke && !g.revokedAt && g.status === "active" && <button type="button" className="btn btn-outline pf-act" onClick={() => void revoke(g)}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LiveSupport({ tenants, requestFor, grants }: { tenants: LiveTenantRow[]; requestFor?: string; grants?: LiveGrant[] }) {
  return (
    <>
      <PageHead title="Support access" subtitle="Time-limited, read-only access to a tenant, with a reason" />
      <GrantForm tenants={tenants.filter((t) => t.status !== "suspended")} initial={requestFor} grants={grants} />
      <p className="pf-note">
        Each grant also shows on the tenant&apos;s own <Link href="/settings/support-access">Settings, support-access</Link> page, where its owners can revoke it. Hours, reason and who asked are in the audit log.
      </p>
    </>
  )
}
