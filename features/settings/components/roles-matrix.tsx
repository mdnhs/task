"use client"

import { toast } from "sonner"

import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import type { Access } from "@/lib/types"
import { matrixStore } from "../store"
import type { MatrixData } from "../types"

const LEVELS: { value: Access; label: string }[] = [
  { value: "none", label: "None" },
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
]
const label = (a: Access) => LEVELS.find((l) => l.value === a)?.label ?? a

// Permission matrix: modules x roles, none / read / write. The Tenant Owner column is fixed so the workspace is never locked out.
// It is a configuration grid with a fixed module list, so it has no pager.
export function RolesMatrix({ data, canWrite, scopeKey }: { data: MatrixData; canWrite: boolean; scopeKey: string }) {
  const [roles, setRoles] = matrixStore.useStore(data.roles, scopeKey)

  function change(roleId: string, moduleId: string, moduleLabel: string, roleLabel: string, next: Access) {
    setRoles((p) => p.map((r) => (r.id === roleId ? { ...r, access: { ...r.access, [moduleId]: next } } : r)))
    toast.success("Permission updated", { description: `${roleLabel}: ${moduleLabel} set to ${label(next)}. Recorded in the audit log.` })
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
              {roles.map((r) => <th key={r.id}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.modules.map((m) => (
              <tr key={m.id}>
                <td data-label="Module"><span className="tt">{m.label}</span></td>
                {roles.map((r) => {
                  const value = r.access[m.id]
                  return (
                    <td key={r.id} data-label={r.label}>
                      {canWrite && r.id !== "owner" ? (
                        <div className="od-filters set-access">
                          <FilterSelect label={`${r.label} access to ${m.label}`} value={value} options={LEVELS} onChange={(v) => change(r.id, m.id, m.label, r.label, v)} />
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
