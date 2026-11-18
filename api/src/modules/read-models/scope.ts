import type { Context } from "hono"
import { can } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../../core/context"
import { driveAllowed } from "../../core/middleware/device"
import { AppError } from "../../core/errors"
import { actorIdOf, subjectUserId } from "../../core/middleware/principal"
import type { TenantTx } from "../../db/tenant-tx"
import { entitlementsFor } from "../entitlements/service"
import { loadRosterCtx, type RosterCtx } from "../rosters"
import { taskCtxOf, type TaskCtx } from "../tasks"
import type { ReportCtx } from "../shift-reports"
import { directReports, peopleAccess } from "../teams"

/**
 * Everything a read model depends on about the caller, resolved ONCE per request, BEFORE the cache is asked (the guards ran before that): the task scope (D5, null = no tasks:read), the report scope
 * (F5, null = no reports access), whether the attention feed is theirs to read, whether Drive text is shown, and whether this is a support session (read-only, never cached).
 */
export type RmScope = {
  tenantId: string
  tz: string
  now: Date
  /** Whose data "me" means: the creator for an API key (it acts as them). */
  me: string
  role: ResolvedRole
  drive: boolean
  support: boolean
  attention: boolean
  tctx: TaskCtx | null
  rctx: ReportCtx | null
  /**
   * The caller's roster context (B8 T14), loaded on first use INSIDE the cache load (a cache hit costs no roster statement); null when the roster is off for this read: the tenant has no M1A, the role has no
   * roster access, or this is a support session (read-only support never reads the roster). `rosterOn` is the cheap bit that goes into the cache key.
   */
  roster: (() => Promise<RosterCtx | null>) | null
  rosterOn: boolean
}

export async function rmScope(c: Context<AppEnv>, tx: TenantTx): Promise<RmScope> {
  const tenant = c.get("tenant")!
  const role = c.get("role")!
  const deps = c.get("deps")
  const me = subjectUserId(c)
  const tctx = await taskCtxOf(c, tx, role)
  const access = await peopleAccess(tx, tenant.id, role, me)
  const drive = driveAllowed(c)
  const now = deps.clock.now()
  const reports = access?.kind === "team" ? (tctx?.scope.kind === "team" ? tctx.reports : await directReports(tx, me)) : []
  const rctx: ReportCtx | null = access ? { tenantId: tenant.id, tz: tenant.timezone, me, actorId: actorIdOf(c), role, access, reports, task: tctx, drive, now } : null
  const support = !!c.get("support")
  const ent = await entitlementsFor(deps, tenant.id) // cached (60 s): no statement
  const rosterOn = !support && ent.allowed.includes("M1A") && can(role, "roster", "read")
  let memo: Promise<RosterCtx | null> | undefined
  const roster = rosterOn
    ? () => (memo ??= loadRosterCtx(c, tx).catch((err) => {
        if (err instanceof AppError && err.status === 403) return null // a role that sees no roster (scope none)
        throw err
      }))
    : null
  return { tenantId: tenant.id, tz: tenant.timezone, now, me, role, drive, support, attention: can(role, "attention"), tctx, rctx, roster, rosterOn }
}

const part = (s: { kind: "all" } | { kind: "team"; managerId: string } | { kind: "own"; personId: string } | null): string =>
  !s ? "none" : s.kind === "all" ? "all" : s.kind === "team" ? `team:${s.managerId}` : `own:${s.personId}`

/**
 * The scope part of a cache key. It names EVERY input of the data about the caller: the task scope, the report scope and the attention access (two roles with the same task scope but different
 * report access must not share an entry), plus `u:<user>` for a personal model (Today, the staff dashboard). Drive text and the local day are separate key parts (cache.ts).
 */
export const scopeKeyOf = (s: RmScope, personal: boolean): string => `t=${part(s.tctx?.scope ?? null)};r=${part(s.rctx?.access ?? null)};a${s.attention ? 1 : 0};ro${s.rosterOn ? 1 : 0}${personal ? `;u=${s.me}` : ""}`

/** Drive text is withheld per request (D22/E13): the cached entry for a device without Drive never holds a link. */
export const freeText = (s: Pick<RmScope, "drive">, withhold: (v: string) => string) => (v: string) => (s.drive ? v : withhold(v))
