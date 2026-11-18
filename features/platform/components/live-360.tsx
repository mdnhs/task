"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BackLink } from "@/components/back-link"
import { usePathname, useRouter } from "next/navigation"

import { CopyId } from "@/components/copy-id"
import { Field } from "@/components/field"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { StretchIndicator } from "@/components/stretch-indicator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Status } from "@/lib/types"
import { planModules, type EntitlementsData, type ProductModule } from "@/lib/entitlements"
import type { Live360, LiveAuditLine } from "../adapters"
import { REASON_MAX, TRIAL_DAYS_MAX, type ModuleOverride } from "../client"
import { dateTimeUtc, dateUtc } from "../format"
import { LIVE_TABS } from "../live-tabs"
import { tenantPath } from "../tenant-360"
import { TENANT_STATUS, type TenantTab } from "../types"
import { AuditList, auditExportHref } from "./live-audit"
import { GrantForm } from "./live-support"
import { SlugConfirmDialog } from "./slug-confirm-dialog"
import { usePlatform } from "./use-platform"

export function Live360Tabs({ id, active, tabs }: { id: string; active: TenantTab; tabs: TenantTab[] }) {
  return (
    <nav className="seg od-seg pf-360-tabs" aria-label="Tenant sections">
      <StretchIndicator active={active} className="seg-ind stretch-ind" />
      {LIVE_TABS.filter((x) => tabs.includes(x.id)).map((x) => (
        <Link key={x.id} href={tenantPath(id, x.id)} aria-current={x.id === active ? "page" : undefined} scroll={false}>
          <span className="seg-lbl">{x.label}</span>
        </Link>
      ))}
    </nav>
  )
}

export type Live360Can = { suspend: boolean; support: boolean }

/** The tenant 360 header on the API: identity, status, and the lifecycle actions (suspend / reactivate with the typed reason, extend trial). */
export function Live360Header({ t, can, tabs }: { t: Live360; can: Live360Can; tabs: TenantTab[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const { client, act } = usePlatform()
  const [open, setOpen] = useState(false)
  const active = (pathname.split("/")[4] ?? "overview") as TenantTab
  const trialing = t.subscriptionStatus === "trialing"
  const items = [
    can.support && !t.suspended && { key: "support", icon: "help", label: "Request support access", go: () => router.push(`/platform/support?request=${encodeURIComponent(t.id)}`) },
    can.suspend && trialing && !t.suspended && { key: "trial", icon: "clock", label: "Extend trial", go: () => router.push(tenantPath(t.id, "extend-trial")) },
  ].filter(Boolean) as { key: string; icon: string; label: string; go(): void }[]

  return (
    <>
      <BackLink href="/platform/tenants">Tenants</BackLink>
      <div className="head pf-360-head">
        <div className="pf-360-id">
          <h1>{t.name}</h1>
          <div className="pf-360-meta">
            <StatusPill status={TENANT_STATUS[t.status]} />
            <span className="pf-360-plan">{t.plan ? `${t.plan} plan` : "No subscription"}</span>
            <span className="pf-slug pf-360-slug"><span className="num">{t.slug}</span><span aria-hidden="true">·</span><span className="num">{t.id}</span><CopyId value={t.id} what="tenant ID" /></span>
          </div>
        </div>
        {(can.suspend || items.length > 0) && (
          <div className="head-actions">
            {can.suspend && t.suspended && <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="unlock" />Reactivate</button>}
            {(items.length > 0 || (can.suspend && !t.suspended)) && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" className="btn btn-outline pf-360-more" aria-label={`More actions for ${t.name}`} />}><Icon name="more" /><span className="pf-360-more-lbl">More</span></DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className="od-menu pf-row-menu">
                  {items.map((i) => <DropdownMenuItem key={i.key} onClick={i.go}><Icon name={i.icon} />{i.label}</DropdownMenuItem>)}
                  {can.suspend && !t.suspended && (
                    <>
                      {items.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem className="pf-danger" onClick={() => setOpen(true)}><Icon name="lock" />Suspend</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      <Live360Tabs id={t.id} active={active} tabs={tabs} />
      {can.suspend && (
        <SlugConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t.suspended ? `Reactivate ${t.name}?` : `Suspend ${t.name}?`}
          text={t.suspended ? `${t.name} gets access again. The reason is recorded in the platform audit trail.` : `Everyone at ${t.name} loses access until you reactivate it. Their data is kept. The reason is recorded in the platform audit trail.`}
          reason
          reasonMin={1}
          reasonMax={REASON_MAX}
          slug={t.suspended ? undefined : t.slug}
          confirmLabel={t.suspended ? "Reactivate" : "Suspend"}
          destructive={!t.suspended}
          onConfirm={(reason) => void act(`tenant:${t.id}`, () => (t.suspended ? client.reactivate(t.id, reason) : client.suspend(t.id, reason)), t.suspended ? `${t.name} reactivated` : `${t.name} suspended`)}
        />
      )}
    </>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="pf-dl-row"><dt>{label}</dt><dd className="num">{children}</dd></div>
const Group = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
  <section className="pf-dl-group" aria-label={title}>
    <h3><Icon name={icon} />{title}</h3>
    <dl className="pf-dl">{children}</dl>
  </section>
)

/** The subscription state as a pill: the raw API word ("past_due") is humanised ("Past due") and toned like the tenant status pill. */
const SUBSCRIPTION: Record<string, Status> = {
  active: { tone: "ok", label: "Active" }, trialing: { tone: "info", label: "Trial" }, past_due: { tone: "warn", label: "Past due" },
  unpaid: { tone: "bad", label: "Unpaid" }, incomplete: { tone: "warn", label: "Incomplete" }, incomplete_expired: { tone: "mute", label: "Expired" },
  canceled: { tone: "mute", label: "Canceled" }, paused: { tone: "mute", label: "Paused" },
}
export const subscriptionPill = (s: string | null): Status => (s === null ? { tone: "mute", label: "None" } : SUBSCRIPTION[s] ?? { tone: "mute", label: s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) })

/** Overview tab: the API's aggregates only (counts and one date), never a member, a name or an email (D8). Three groups: subscription, usage, tenant. */
export function LiveOverviewTab({ t }: { t: Live360 }) {
  const pct = t.seats ? Math.min(100, Math.round((t.seatsUsed / t.seats) * 100)) : 0
  return (
    <section className="card" aria-labelledby="pf-ov-h">
      <div className="card-head"><div><h2 id="pf-ov-h">Overview</h2><div className="sub">Counts only. Member details stay in the tenant.</div></div></div>
      <div className="pf-dl-groups">
        <Group title="Subscription" icon="wallet">
          <Row label="Plan">{t.plan || "—"}</Row>
          <Row label="Status"><StatusPill status={subscriptionPill(t.subscriptionStatus)} tick={false} /></Row>
          {t.trialEndsAt && <Row label="Trial ends">{dateUtc(t.trialEndsAt)}</Row>}
          {t.currentPeriodEnd && <Row label={t.cancelAtPeriodEnd ? "Ends" : "Renews"}>{dateUtc(t.currentPeriodEnd)}</Row>}
        </Group>
        <Group title="Usage" icon="layers">
          <div className="pf-dl-row pf-dl-seats">
            <dt>Seats</dt>
            <dd className="num">{t.seats === null ? `${t.seatsUsed} used` : <>{t.seatsUsed} <span>of {t.seats}</span></>}</dd>
            {t.seats !== null && <div suppressHydrationWarning className="progress pf-dl-bar" role="img" aria-label={`${t.seatsUsed} of ${t.seats} seats used`}><i style={{ width: `${pct}%` }} /></div>}
          </div>
          <Row label="Members">{t.memberCount}</Row>
          <Row label="Open data requests">{t.openDataRequests}</Row>
        </Group>
        <Group title="Tenant" icon="folder">
          <Row label="Created">{dateUtc(t.createdAt)}</Row>
          <Row label="Last activity">{t.lastActivityDate ? dateUtc(t.lastActivityDate) : "None yet"}</Row>
          <Row label="Time zone">{t.timezone}</Row>
          <Row label="Currency">{t.currency}</Row>
        </Group>
      </div>
    </section>
  )
}

type Draft = Record<string, ModuleOverride["mode"] | null>

/**
 * Modules tab (owner edits): the plan's modules plus this tenant's overrides. Changes are drafted, then saved as ONE call that sends the FULL overrides array with the reason (the API
 * replaces the list). A core module can't be revoked.
 */
export function LiveModulesTab({ t, catalogue, plans, core, canEdit }: { t: Live360; catalogue: ProductModule[]; plans: Record<string, string[]>; core: string[]; canEdit: boolean }) {
  const { client, act } = usePlatform()
  const [draft, setDraft] = useState<Draft>({})
  const [open, setOpen] = useState(false)
  const saved: ModuleOverride[] = t.overrides.map((o) => ({ module: o.module, mode: o.mode }))
  const overrides = useMemo<ModuleOverride[]>(() => {
    const m = new Map(saved.map((o) => [o.module, o.mode]))
    for (const [k, v] of Object.entries(draft)) {
      if (v === null) m.delete(k)
      else m.set(k, v)
    }
    return [...m].map(([module, mode]) => ({ module, mode }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.overrides, draft])
  const ent = { productModules: catalogue, plans, core, modules: {}, assistant: "", defaultPlan: t.planId ?? "" } satisfies EntitlementsData
  const rows = planModules(ent, t.planId ?? "", overrides)
  const dirty = Object.keys(draft).length > 0
  const why = (m: string) => t.overrides.find((o) => o.module === m)

  return (
    <section className="card" aria-labelledby="pf-mods-h">
      <div className="card-head">
        <div><h2 id="pf-mods-h">Modules</h2><div className="sub">{rows.filter((m) => m.included).length} of {rows.length} included · {t.plan || "no"} plan{overrides.length ? ` with ${overrides.length} override${overrides.length === 1 ? "" : "s"}` : ""}</div></div>
        {canEdit && dirty && <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Save changes</button>}
      </div>
      <ul className="pf-modlist">
        {rows.map((m) => {
          const isCore = core.includes(m.id)
          const pill = m.override === "grant" ? { tone: "info" as const, label: "Granted add-on" } : m.override === "revoke" ? { tone: "warn" as const, label: "Revoked" } : m.included ? { tone: "ok" as const, label: "Included" } : { tone: "mute" as const, label: "Not in plan" }
          const next: ModuleOverride["mode"] | null | undefined = m.override ? null : !m.inPlan ? "grant" : isCore ? undefined : "revoke"
          const note = why(m.id)
          return (
            <li key={m.id}>
              <div className="pf-modlist-main">
                <span className={m.included ? "tt" : "tt pf-mod-off"}>{m.label}</span>
                <span className="pf-modlist-d">{m.description}</span>
                {note && !(m.id in draft) && <span className="pf-modlist-why">{note.reason}</span>}
              </div>
              <div className="pf-modlist-side">
                <StatusPill status={pill} />
                {canEdit && next !== undefined && (
                  <button type="button" className="btn btn-outline pf-act" onClick={() => setDraft((d) => ({ ...d, [m.id]: next }))}>{next === "grant" ? "Grant" : next === "revoke" ? "Revoke" : "Reset to plan"}</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {canEdit && (
        <SlugConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`Save module changes for ${t.name}?`}
          text="The new overrides replace the current ones and take effect within a minute. The reason is recorded in the platform audit trail."
          reason
          reasonMin={1}
          reasonMax={REASON_MAX}
          confirmLabel="Save"
          onConfirm={(reason) => void act(`modules:${t.id}`, () => client.setModules(t.id, overrides, reason), "Modules saved").then((r) => r.ok && setDraft({}))}
        />
      )}
    </section>
  )
}

export function LiveTenantSupportTab({ t, canGrant }: { t: Live360; canGrant: boolean }) {
  return canGrant && !t.suspended ? (
    <GrantForm tenants={[{ id: t.id, name: t.name }]} tenantId={t.id} />
  ) : (
    <section className="card"><div className="card-head"><div><h2>Support access</h2><div className="sub">{t.suspended ? "A suspended tenant can't be entered." : "Your role can't request support access."}</div></div></div></section>
  )
}

export function LiveAuditTab({ t, lines }: { t: Live360; lines: LiveAuditLine[] }) {
  return (
    <section className="card" aria-labelledby="pf-aud-h">
      <div className="card-head">
        <div><h2 id="pf-aud-h">Audit</h2><div className="sub">Platform actions on {t.name}</div></div>
        <a className="pill-btn" href={auditExportHref(t.id)} download>Export CSV</a>
      </div>
      {lines.length ? <AuditList lines={lines} /> : <p className="pf-note">No platform actions on this tenant yet.</p>}
    </section>
  )
}

/** The long form behind "Extend trial" (rule 31): whole days 1 to 30 and a reason; the API refuses a tenant that is not trialing (422 not_trialing). */
export function LiveExtendTrial({ t }: { t: Live360 }) {
  const router = useRouter()
  const { client, act } = usePlatform()
  const [days, setDays] = useState("7")
  const [reason, setReason] = useState("")
  const trialing = t.subscriptionStatus === "trialing"
  return (
    <>
      <BackLink href={tenantPath(t.id)}>{t.name}</BackLink>
      <div className="head"><div><h1>Extend trial</h1><p>{trialing && t.trialEndsAt ? `Ends ${dateTimeUtc(t.trialEndsAt)}. The new end is the later of now and that, plus the days.` : "This tenant is not on a trial."}</p></div></div>
      <form className="card pf-card pf-form" onSubmit={(e) => { e.preventDefault(); void act(`trial:${t.id}`, () => client.extendTrial(t.id, Number(days), reason), "Trial extended").then((r) => r.ok && router.push(tenantPath(t.id))) }}>
        <Field label="Days" htmlFor="pf-trial-days" hint={`1 to ${TRIAL_DAYS_MAX}`} required><Input id="pf-trial-days" type="number" inputMode="numeric" min={1} max={TRIAL_DAYS_MAX} step={1} value={days} disabled={!trialing} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="pf-trial-reason" hint={`Up to ${REASON_MAX} characters`} required><Textarea id="pf-trial-reason" rows={2} maxLength={REASON_MAX} value={reason} disabled={!trialing} onChange={(e) => setReason(e.target.value)} /></Field>
        <button type="submit" className="btn btn-primary" disabled={!trialing || reason.trim() === ""}><Icon name="clock" />Extend trial</button>
      </form>
    </>
  )
}
