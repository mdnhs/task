"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Input } from "@/components/ui/input"
import type { LiveStaff } from "../adapters"
import { STAFF_ROLES, STAFF_ROLE_LABEL } from "../permissions"
import { STAFF_STATUS, mfaLabel } from "../team"
import type { StaffRole } from "../types"
import { usePlatform } from "./use-platform"

const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABEL[r] }))

/** Platform staff on the API (owner only). The API refuses demoting or suspending the last active owner (409 last_platform_owner); every staff member needs two-step verification on every request. */
export function LiveTeam({ staff, meId }: { staff: LiveStaff[]; meId: string }) {
  const { client, act } = usePlatform()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<StaffRole>("support")
  return (
    <>
      <PageHead title="Team" subtitle="Platform staff, their roles and two-step verification" />
      <div className="card pf-card">
        <div className="table-wrap">
          <table className="rtable pf-table">
            <thead><tr><th>Member</th><th>Role</th><th>Two-step</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <td data-label="Member"><div className="tt">{m.name}{m.id === meId ? " (you)" : ""}</div><div className="tm">{m.email}</div></td>
                  <td data-label="Role">
                    <FilterSelect label={`Role of ${m.name}`} value={m.role} options={ROLE_OPTIONS} onChange={(v) => void act(`staff:${m.id}`, () => client.patchStaff(m.id, { role: v }), `${m.name} is now ${STAFF_ROLE_LABEL[v]}`)} />
                  </td>
                  <td data-label="Two-step"><StatusPill status={mfaLabel(m)} /></td>
                  <td data-label="Status"><StatusPill status={STAFF_STATUS[m.status]} /></td>
                  <td>
                    <button type="button" className="btn btn-outline pf-act" onClick={() => void act(`staff:${m.id}`, () => client.patchStaff(m.id, { status: m.status === "active" ? "suspended" : "active" }), m.status === "active" ? `${m.name} suspended` : `${m.name} reactivated`)}>
                      {m.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card pf-card">
        <div className="card-head"><div><h2>Add staff</h2><div className="sub">The person must already have an account.</div></div></div>
        <form className="pf-form" onSubmit={(e) => { e.preventDefault(); void act("staff:add", () => client.addStaff(email, role), "Staff member added").then((r) => r.ok && setEmail("")) }}>
          <Field label="Email" htmlFor="pf-staff-email" required><Input id="pf-staff-email" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></Field>
          <FilterSelect label="Role" value={role} options={ROLE_OPTIONS} onChange={(v) => setRole(v as StaffRole)} />
          <button type="submit" className="btn btn-primary" disabled={email.trim() === ""}><Icon name="plus" />Add staff</button>
        </form>
      </div>
    </>
  )
}
