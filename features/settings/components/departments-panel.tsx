"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { paginate } from "@/lib/paginate"
import { DEPARTMENTS_PAGE_SIZE } from "../constants"
import { departmentsStore } from "../store"
import type { Department } from "../types"

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)
const schema = z.object({
  name: z.string().trim().min(2, "Enter a department name").max(40, "Keep the name under 40 characters"),
  reportOwner: z.string().min(1, "Choose the report owner"),
})

// Departments, sites and teams (FR-ORG-02): add, rename, deactivate. Each has sites, teams and a report owner.
export function DepartmentsPanel({ departments, owners, canWrite, scopeKey }: { departments: Department[]; owners: string[]; canWrite: boolean; scopeKey: string }) {
  const [stored, setStored] = departmentsStore.useStore(departments, scopeKey)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<{ dep?: Department; n: number } | null>(null)
  const [confirm, setConfirm] = useState<Department | null>(null)
  const paged = paginate(stored, page, DEPARTMENTS_PAGE_SIZE)

  function save(next: Omit<Department, "id" | "active">, id?: string) {
    if (id) {
      setStored((p) => p.map((d) => (d.id === id ? { ...d, ...next } : d)))
      toast.success("Department updated", { description: next.name })
    } else {
      setStored((p) => [...p, { ...next, id: `dep-${Date.now().toString(36)}`, active: true }])
      toast.success("Department added", { description: next.name })
    }
  }
  const setActive = (d: Department, active: boolean) => {
    setStored((p) => p.map((x) => (x.id === d.id ? { ...x, active } : x)))
    toast.success(active ? "Department reactivated" : "Department deactivated", { description: d.name })
  }

  return (
    <section className="card set-card" aria-labelledby="set-dep-h">
      <div className="card-head">
        <div>
          <h2 id="set-dep-h">Departments, sites and teams</h2>
          <div className="sub">{stored.filter((d) => d.active).length} active of {stored.length}</div>
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
            <li key={d.id} className="set-dep" data-inactive={d.active ? undefined : ""}>
              <div className="set-dep-main">
                <span className="set-dep-top">
                  <span className="set-dep-name">{d.name}</span>
                  <StatusPill status={d.active ? { tone: "ok", label: "Active" } : { tone: "mute", label: "Inactive" }} />
                </span>
                <span className="set-dep-line"><b>Report owner:</b> {d.reportOwner}</span>
                <span className="set-dep-line"><b>Sites:</b> {d.sites.join(", ") || "None"}</span>
                <span className="set-dep-line"><b>Teams:</b> {d.teams.join(", ") || "None"}</span>
              </div>
              {canWrite && (
                <span className="set-actions">
                  <button type="button" className="btn btn-outline" onClick={() => setEditing((e) => ({ dep: d, n: (e?.n ?? 0) + 1 }))}>Edit</button>
                  {d.active ? (
                    <button type="button" className="btn btn-outline" onClick={() => setConfirm(d)}>Deactivate</button>
                  ) : (
                    <button type="button" className="btn btn-outline" onClick={() => setActive(d, true)}>Reactivate</button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="roster" title="No departments yet" text="Add a department to organise sites, teams and report owners." />
      )}
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Departments pages" onPageChange={setPage} />
      {editing && <DepartmentDialog key={editing.n} dep={editing.dep} owners={owners} onClose={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Deactivate ${confirm?.name ?? "department"}?`}
        text="It stays in history and can be reactivated later. New tasks and reports can no longer be assigned to it."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => confirm && setActive(confirm, false)}
      />
    </section>
  )
}

function DepartmentDialog({ dep, owners, onClose, onSave }: { dep?: Department; owners: string[]; onClose(): void; onSave(d: Omit<Department, "id" | "active">, id?: string): void }) {
  const [name, setName] = useState(dep?.name ?? "")
  const [owner, setOwner] = useState(dep?.reportOwner ?? "")
  const [sites, setSites] = useState(dep?.sites.join(", ") ?? "")
  const [teams, setTeams] = useState(dep?.teams.join(", ") ?? "")
  const [errors, setErrors] = useState<{ name?: string; reportOwner?: string }>({})
  const options = [{ value: "", label: "Choose an owner" }, ...owners.map((o) => ({ value: o, label: o }))]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ name, reportOwner: owner })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof typeof errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    onSave({ name: parsed.data.name, reportOwner: parsed.data.reportOwner, sites: list(sites), teams: list(teams) }, dep?.id)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{dep ? "Edit department" : "Add department"}</DialogTitle>
          <DialogDescription>Sites and teams are comma separated.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Name" htmlFor="dep-name" error={errors.name} required>
            <Input id="dep-name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })) }} />
          </Field>
          <Field label="Report owner" htmlFor="dep-owner" error={errors.reportOwner} required>
            <FilterSelect label="Report owner" value={owner} options={options} onChange={(v) => { setOwner(v); setErrors((x) => ({ ...x, reportOwner: undefined })) }} />
          </Field>
          <Field label="Sites" htmlFor="dep-sites">
            <Input id="dep-sites" value={sites} onChange={(e) => setSites(e.target.value)} placeholder="Canary Wharf, Riverside House" />
          </Field>
          <Field label="Teams" htmlFor="dep-teams">
            <Input id="dep-teams" value={teams} onChange={(e) => setTeams(e.target.value)} placeholder="Day patrol, Night patrol" />
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
