"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { auditEntry, nextId, nowIso } from "../logic"
import { auditStore, requestsStore } from "../store"
import type { PlatformTenant } from "../types"

const schema = z.object({
  tenantId: z.string().min(1, "Choose a tenant"),
  reason: z.string().trim().min(10, "Explain why in at least 10 characters").max(300, "Keep the reason under 300 characters"),
})
type Errors = Partial<Record<"tenantId" | "reason", string>>

// The tenant's admin has to grant it before anything is visible (FR-SAAS-09); this only files the request.
export function RequestDialog({ tenants, open, onOpenChange, actor, today }: { tenants: PlatformTenant[]; open: boolean; onOpenChange(o: boolean): void; actor: string; today: string }) {
  const [tenantId, setTenantId] = useState("")
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
    requestsStore.set((all) => [
      { id: nextId("SUP", all.map((r) => r.id)), tenantId: tenant.id, requester: actor, reason: parsed.data.reason, status: "requested", requestedAt: at, expiresAt: null, grantedBy: null },
      ...all,
    ])
    auditStore.set((all) => [auditEntry(all, at, actor, "support.requested", tenant.name, `Support access requested: ${parsed.data.reason}`), ...all])
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
