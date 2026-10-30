"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { nextId, nowIso, sensitiveEntry } from "../logic"
import { auditOutbox, knownAudit, requestsStore } from "../store"
import type { PlatformTenant } from "../types"
import type { Operator } from "./tenants-view"

const schema = z.object({
  tenantId: z.string().min(1, "Choose a tenant"),
  reason: z.string().trim().min(10, "Explain why in at least 10 characters").max(300, "Keep the reason under 300 characters"),
})
type Errors = Partial<Record<"tenantId" | "reason", string>>

// The tenant's admin has to grant it before anything is visible (FR-SAAS-09); this only files the request.
// `initialTenantId`: preselected when opened from a tenant (the tenants list's "Request support access").
// The requester and the audit actor are the operator (name + staff role, D7), never the session role's label.
export function RequestDialog({ tenants, open, onOpenChange, operator, today, initialTenantId = "" }: { tenants: Pick<PlatformTenant, "id" | "name">[]; open: boolean; onOpenChange(o: boolean): void; operator: Operator; today: string; initialTenantId?: string }) {
  const [tenantId, setTenantId] = useState(initialTenantId)
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<Errors>({})

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setTenantId("")
      setReason("")
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ tenantId, reason })
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    const tenant = tenants.find((t) => t.id === parsed.data.tenantId)
    if (!tenant) return
    const at = nowIso(today)
    const id = nextId("SUP", (requestsStore.get() ?? []).map((r) => r.id))
    const line = sensitiveEntry(knownAudit(), {
      at, actor: operator.name, staffRole: operator.role, tenantId: tenant.id, action: "support.requested", target: tenant.name,
      detail: `Support access requested: ${parsed.data.reason}`, before: {}, after: { request: id, status: "requested" }, reason: parsed.data.reason,
    })
    requestsStore.set((all) => [
      { id, tenantId: tenant.id, requester: operator.name, reason: parsed.data.reason, status: "requested", requestedAt: at, expiresAt: null, grantedBy: null },
      ...all,
    ])
    auditOutbox.set((list) => [line, ...list])
    toast.success(`Support access requested from ${tenant.name}`)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Request support access</DialogTitle>
          <DialogDescription>The tenant&apos;s admin decides whether to grant it and for how long.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Tenant" htmlFor="pf-req-tenant" error={errors.tenantId} required>
            <FilterSelect
              label="Tenant"
              value={tenantId}
              options={[{ value: "", label: "Choose a tenant" }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]}
              onChange={(v) => {
                setTenantId(v)
                setErrors((e) => ({ ...e, tenantId: undefined }))
              }}
            />
          </Field>
          <Field label="Reason" htmlFor="pf-req-reason" error={errors.reason} required>
            <Textarea
              id="pf-req-reason"
              placeholder="e.g. Shift reports fail to save since Monday"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setErrors((x) => (x.reason ? { ...x, reason: undefined } : x))
              }}
            />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Send request</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
