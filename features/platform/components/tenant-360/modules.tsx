"use client"

import { useState } from "react"
import { toast } from "sonner"

import { StatusPill } from "@/components/status-pill"
import { planModules } from "@/lib/entitlements"
import type { EntitlementsData } from "@/lib/entitlements"
import { nowIso, overrideModule } from "../../logic"
import { moduleAction, type ModulesTab, type T360Head } from "../../tenant-360"
import { SlugConfirmDialog } from "../slug-confirm-dialog"
import { commitTenant, useLiveTenant, type T360Ctx } from "./live"

type Pending = { module: string; label: string; mode: "grant" | "revoke" | null; inPlan: boolean }

// Modules tab: the plan's product modules plus this tenant's overrides (grant an add-on the plan lacks, revoke one it
// has, or reset to the plan). The effective set is lib/entitlements.ts → planModules/effectiveModules, the same path the
// tenant app's plan entitlements take. Core modules can't be revoked.
export function ModulesTabView({ head, data, ctx }: { head: T360Head; data: ModulesTab; ctx: T360Ctx }) {
  const t = useLiveTenant(head.tenant, head.can.amounts)
  const plan = head.plans.find((p) => p.id === t.plan)
  const [pending, setPending] = useState<Pending | null>(null)
  const ent = { productModules: data.catalogue, plans: data.plans, core: data.core, modules: {}, assistant: "", defaultPlan: t.plan } satisfies EntitlementsData
  const rows = planModules(ent, t.plan, t.moduleOverrides)
  const included = rows.filter((m) => m.included).length
  const overrides = rows.filter((m) => m.override).length

  function confirm(reason: string) {
    if (!pending) return
    const after = overrideModule(t, pending.module, pending.mode, pending.inPlan, { at: nowIso(ctx.today), by: ctx.operator.name, reason, core: data.core })
    const what = pending.mode === "grant" ? "Granted" : pending.mode === "revoke" ? "Revoked" : "Reset to plan:"
    commitTenant(ctx, t, after, { action: "tenant.module_override", detail: `${what} ${pending.label}: ${reason}`, reason })
    toast.success(pending.mode === "grant" ? `${pending.label} granted` : pending.mode === "revoke" ? `${pending.label} revoked` : `${pending.label} follows the plan again`)
  }

  return (
    <section className="card" aria-labelledby="pf-mods-h">
      <div className="card-head">
        <div>
          <h2 id="pf-mods-h">Modules</h2>
          <div className="sub">{`${included} of ${rows.length} included · ${plan?.name ?? t.plan} plan${overrides ? ` with ${overrides} override${overrides === 1 ? "" : "s"}` : ""}`}</div>
        </div>
      </div>
      <ul className="pf-modlist">
        {rows.map((m) => {
          const core = data.core.includes(m.id)
          const why = t.moduleOverrides?.find((o) => o.module === m.id)
          const pill = m.override === "grant"
            ? { tone: "info" as const, label: "Granted add-on" }
            : m.override === "revoke"
              ? { tone: "warn" as const, label: "Revoked" }
              : m.included ? { tone: "ok" as const, label: "Included" } : { tone: "mute" as const, label: "Not in plan" }
          const action = moduleAction(m, core)
          return (
            <li key={m.id}>
              <div className="pf-modlist-main">
                <span className={m.included ? "tt" : "tt pf-mod-off"}>{m.label}</span>
                <span className="pf-modlist-d">{m.description}</span>
                {why && <span className="pf-modlist-why">{why.by}: {why.reason}</span>}
              </div>
              <div className="pf-modlist-side">
                <StatusPill status={pill} />
                {head.can.modules && action !== undefined && (
                  <button type="button" className="btn btn-outline pf-act" onClick={() => setPending({ module: m.id, label: m.label, mode: action, inPlan: m.inPlan })}>
                    {action === "grant" ? "Grant" : action === "revoke" ? "Revoke" : "Reset to plan"}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {head.can.modules && pending && (
        <SlugConfirmDialog
          open={!!pending}
          onOpenChange={(o) => !o && setPending(null)}
          title={pending.mode === "grant" ? `Grant ${pending.label} to ${t.name}?` : pending.mode === "revoke" ? `Revoke ${pending.label} from ${t.name}?` : `Reset ${pending.label} to the plan?`}
          text={
            pending.mode === "grant"
              ? `${t.name} gets ${pending.label} on top of its plan until the override is reset. The reason is recorded in the platform audit trail.`
              : pending.mode === "revoke"
                ? `${t.name} loses ${pending.label} although its plan includes it. Its users stop seeing the module. The reason is recorded in the platform audit trail.`
                : `${pending.label} follows the ${plan?.name ?? ""} plan again. The reason is recorded in the platform audit trail.`
          }
          reason
          slug={pending.mode === "revoke" ? t.slug : undefined}
          confirmLabel={pending.mode === "grant" ? "Grant" : pending.mode === "revoke" ? "Revoke" : "Reset"}
          destructive={pending.mode === "revoke"}
          onConfirm={confirm}
        />
      )}
    </section>
  )
}
