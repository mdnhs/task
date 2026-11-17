"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { Icon } from "@/components/icons"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { paginate } from "@/lib/paginate"
import { makeSettingsClient } from "../client"
import { DEPARTMENTS_PAGE_SIZE } from "../constants"
import type { Department } from "../types"

const schema = z.object({ name: z.string().trim().min(2, "Enter a department name").max(40, "Keep the name under 40 characters") })

// Departments (FR-ORG-02): a department is a team of kind "department" (GET/POST/PATCH/DELETE /v1/teams). Add, rename, delete. Renaming keeps the shift report template
// (the API carries it in the same transaction). Sites, report owners and deactivation have no backend, so they are not offered.
export function DepartmentsPanel({ departments, canWrite }: { departments: Department[]; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<{ dep?: Department; n: number } | null>(null)
  const [confirm, setConfirm] = useState<Department | null>(null)
  const paged = paginate(departments, page, DEPARTMENTS_PAGE_SIZE)

  async function save(name: string, id?: string) {
    const r = await run(id ? `dep:${id}` : "dep:new", () => (id ? client.renameDepartment(id, name) : client.createDepartment(name)))
    if (r.ok) toast.success(id ? "Department updated" : "Department added", { description: name })
    return r.ok
  }
  async function remove(d: Department) {
    const r = await run(`dep:${d.id}`, () => client.deleteDepartment(d.id))
    if (r.ok) toast.success("Department deleted", { description: d.name })
  }

  return (
    <section className="card set-card" aria-labelledby="set-dep-h">
      <div className="card-head">
        <div>
          <h2 id="set-dep-h">Departments</h2>
          <div className="sub">{departments.length} {departments.length === 1 ? "department" : "departments"}</div>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing((e) => ({ n: (e?.n ?? 0) + 1 }))}>
            <Icon name="plus" />
            Add department
          </button>
        )}
      </div>
      {paged.rows.length > 0 ? (
        <ul className="set-list">
          {paged.rows.map((d) => (
            <li key={d.id} className="set-dep">
              <div className="set-dep-main">
                <span className="set-dep-top"><span className="set-dep-name">{d.name}</span></span>
                <span className="set-dep-line"><b>People:</b> <span className="num">{d.members}</span></span>
              </div>
              {canWrite && (
                <span className="set-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setEditing((e) => ({ dep: d, n: (e?.n ?? 0) + 1 }))}>Rename</button>
                  <button type="button" className="btn btn-outline" onClick={() => setConfirm(d)}>Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="roster" title="No departments yet" text="Add a department to group your people." />
      )}
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Departments pages" onPageChange={setPage} />
      {editing && <DepartmentDialog key={editing.n} dep={editing.dep} onClose={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.name ?? "department"}?`}
        text="People stay in the workspace; tasks keep existing without this department. A department that still has shifts can't be deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirm && void remove(confirm)}
      />
    </section>
  )
}

function DepartmentDialog({ dep, onClose, onSave }: { dep?: Department; onClose(): void; onSave(name: string, id?: string): Promise<boolean> }) {
  const [name, setName] = useState(dep?.name ?? "")
  const [error, setError] = useState<string>()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ name })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message)
    if (await onSave(parsed.data.name, dep?.id)) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{dep ? "Rename department" : "Add department"}</DialogTitle>
          <DialogDescription>{dep ? "The report template follows the new name." : "People are added to it on the Users tab."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Name" htmlFor="dep-name" error={error} required>
            <Input id="dep-name" value={name} onChange={(e) => { setName(e.target.value); setError(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">{dep ? "Save changes" : "Add department"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
