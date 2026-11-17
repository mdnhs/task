"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
  const [copying, setCopying] = useState(0)
  // the role just copied: its column is highlighted once the page re-reads (the new column is the last one the API lists for that label)
  const [fresh, setFresh] = useState<string | null>(null)
  const anyLocked = data.roles.some((r) => r.locked)

  async function copy(sourceUuid: string, label: string) {
    const r = await run(`clone:${sourceUuid}`, () => client.cloneRole(sourceUuid, label))
    if (r.ok) {
      setFresh(label)
      toast.success("Role copied", { description: `${label} is editable below.` })
    }
    return r.ok
  }

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
        {canWrite && (
          <button type="button" className="btn btn-outline" onClick={() => setCopying((n) => n + 1)}>
            <Icon name="plus" />
            Copy role
          </button>
        )}
      </div>
      <p className="set-notice">
        <Icon name="history" />
        <span>Changes are audited{anyLocked ? ". Built-in roles are fixed: copy one to edit it." : ""}</span>
      </p>
      <div className="table-wrap">
        <table className="rtable set-matrix">
          <thead>
            <tr>
              <th>Module</th>
              {data.roles.map((r) => <th key={r.id} data-fresh={fresh === r.label ? "" : undefined}>{r.label}</th>)}
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
      {copying > 0 && <CopyDialog key={copying} roles={data.roles} onClose={() => setCopying(0)} onCopy={copy} />}
    </section>
  )
}

function CopyDialog({ roles, onClose, onCopy }: { roles: MatrixData["roles"]; onClose(): void; onCopy(sourceUuid: string, label: string): Promise<boolean> }) {
  const [source, setSource] = useState(roles.find((r) => r.id !== "owner")?.uuid ?? roles[0]?.uuid ?? "")
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = name.trim()
    if (label.length < 2 || label.length > 80) return setError("Enter a name between 2 and 80 characters.")
    if (await onCopy(source, label)) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Copy role</DialogTitle>
          <DialogDescription>Make an editable copy of a role, then change what it can open.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Copy from" htmlFor="role-src">
            <FilterSelect label="Copy from" value={source} onChange={setSource} options={roles.map((r) => ({ value: r.uuid, label: r.label }))} />
          </Field>
          <Field label="New role name" htmlFor="role-name" error={error} required>
            <Input id="role-name" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setError(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Copy role</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
