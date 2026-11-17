"use client"

import { toast } from "sonner"

import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import type { Access } from "@/lib/types"
import { makeSettingsClient } from "../client"
import type { MatrixData } from "../types"

const LEVELS: { value: Access; label: string }[] = [
  { value: "none", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
]
const label = (a: Access) => LEVELS.find((l) => l.value === a)?.label ?? a

// Permission matrix: modules x roles, none / read / write (GET /v1/roles, PATCH /v1/roles/{id}). The Tenant Owner column is fixed so the workspace is never locked out.
// A change that would give a role more access than yours is refused by the API (403 role_escalation): the page re-reads and shows one toast.
// It is a configuration grid with a fixed module list, so it has no pager.
export function RolesMatrix({ data, canWrite }: { data: MatrixData; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })

  async function change(roleUuid: string, moduleId: (typeof data.modules)[number], roleLabel: string, next: Access) {
    const r = await run(`role:${roleUuid}:${moduleId.id}`, () => client.setRoleAccess(roleUuid, moduleId.id, next))
    if (r.ok) toast.success("Permission updated", { description: `${roleLabel}: ${moduleId.label} set to ${label(next)}. Recorded in the audit log.` })
  }

  return (
    <section className="card set-card" aria-labelledby="set-roles-h" data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="set-roles-h">Roles and permissions</h2>
          <div className="sub">What each role can open and change, per module</div>
        </div>
      </div>
      <p className="set-notice">
        <Icon name="history" />
        <span>Changes are audited</span>
      </p>
      <div className="table-wrap">
        <table className="rtable set-matrix">
          <thead>
            <tr>
              <th>Module</th>
              {data.roles.map((r) => <th key={r.id}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.modules.map((m) => (
              <tr key={m.id}>
                <td data-label="Module"><span className="tt">{m.label}</span></td>
                {data.roles.map((r) => {
                  const value = r.access[m.id]
                  return (
                    <td key={r.id} data-label={r.label}>
                      {canWrite && !r.locked ? (
                        <div className="od-filters set-access">
                          <FilterSelect label={`${r.label} access to ${m.label}`} value={value} options={LEVELS} onChange={(v) => void change(r.uuid, m, r.label, v)} />
                        </div>
                      ) : (
                        <span className={`set-level set-level-${value}`}>{label(value)}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
