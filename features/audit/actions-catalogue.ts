// Every action the API records in a tenant's audit chain (api/src: recordAudit), with the label the log shows, its tone and whether it is a sensitive one.
// A test scans api/src for the action literals and fails when one is missing here, so a new audited action cannot reach the page without a name.
import type { Tone } from "@/lib/types"

type Info = { label: string; tone: Tone; sensitive?: true }
const S = true as const

export const AUDIT_ACTIONS: Record<string, Info> = {
  // access and people
  "member.joined": { label: "Member joined", tone: "ok" },
  "member.removed": { label: "Member removed", tone: "bad", sensitive: S },
  "member.role_changed": { label: "Role change", tone: "warn", sensitive: S },
  "member.manager_set": { label: "Manager set", tone: "mute" },
  "role.cloned": { label: "Role copied", tone: "warn", sensitive: S },
  "role.updated": { label: "Role changed", tone: "warn", sensitive: S },
  "invite.created": { label: "Invite sent", tone: "info", sensitive: S },
  "invite.resent": { label: "Invite resent", tone: "info", sensitive: S },
  "invite.revoked": { label: "Invite revoked", tone: "warn", sensitive: S },
  "team.created": { label: "Team added", tone: "mute" },
  "team.updated": { label: "Team changed", tone: "mute" },
  "team.deleted": { label: "Team deleted", tone: "bad" },
  "team.members_set": { label: "Team members set", tone: "mute" },
  // security
  "settings.mfa_policy.updated": { label: "Two-step rule changed", tone: "warn", sensitive: S },
  "device.registered": { label: "Device added", tone: "info", sensitive: S },
  "device.updated": { label: "Device changed", tone: "mute", sensitive: S },
  "device.retired": { label: "Device removed", tone: "bad", sensitive: S },
  "device.enrolment_issued": { label: "Enrolment code issued", tone: "warn", sensitive: S },
  "device.bound": { label: "Device set up", tone: "ok", sensitive: S },
  "device_policy.set": { label: "Device policy changed", tone: "warn", sensitive: S },
  "api_key.created": { label: "API key created", tone: "warn", sensitive: S },
  "api_key.revoked": { label: "API key revoked", tone: "bad", sensitive: S },
  "webhook.created": { label: "Webhook added", tone: "info", sensitive: S },
  "webhook.updated": { label: "Webhook changed", tone: "mute", sensitive: S },
  "webhook.deleted": { label: "Webhook deleted", tone: "bad", sensitive: S },
  "webhook.auto_disabled": { label: "Webhook paused", tone: "bad" },
  "support.granted": { label: "Support access granted", tone: "warn", sensitive: S },
  "support.revoked": { label: "Support access revoked", tone: "mute", sensitive: S },
  "integration.connected": { label: "Integration connected", tone: "ok", sensitive: S },
  "integration.disconnected": { label: "Integration disconnected", tone: "bad", sensitive: S },
  "integration.refresh_failed": { label: "Integration sign-in failed", tone: "bad" },
  // data and privacy
  "audit.exported": { label: "Audit exported", tone: "info", sensitive: S },
  "dsr.requested": { label: "Data request opened", tone: "info", sensitive: S },
  "dsr.completed": { label: "Data request done", tone: "ok", sensitive: S },
  "dsr.rejected": { label: "Data request declined", tone: "warn", sensitive: S },
  "dsr.failed": { label: "Data request failed", tone: "bad", sensitive: S },
  "dsr.retried": { label: "Data request retried", tone: "mute", sensitive: S },
  "dsr.export_completed": { label: "Data export ready", tone: "ok", sensitive: S },
  "dsr.export_expired": { label: "Data export expired", tone: "mute" },
  "dsr.erasure_completed": { label: "Erasure done", tone: "bad", sensitive: S },
  "file.deleted": { label: "File deleted", tone: "bad" },
  "file.infected": { label: "File blocked (virus)", tone: "bad", sensitive: S },
  // settings and billing
  "tenant.created": { label: "Workspace created", tone: "ok" },
  "tenant.settings_updated": { label: "Organisation changed", tone: "mute" },
  "tenant.branding_updated": { label: "Branding changed", tone: "mute" },
  "tenant.holidays_replaced": { label: "Holidays changed", tone: "mute" },
  "tenant.report_template_updated": { label: "Report template changed", tone: "mute" },
  "tenant.demo_seeded": { label: "Demo data loaded", tone: "mute" },
  "subscription.changed": { label: "Billing", tone: "warn" },
  "invoice.payment_failed": { label: "Payment failed", tone: "bad" },
  "module_override.set": { label: "Module access changed", tone: "warn", sensitive: S },
  "module_override.cleared": { label: "Module access reset", tone: "mute", sensitive: S },
  // work
  "task.archived": { label: "Task archived", tone: "mute" },
  "task.restored": { label: "Task restored", tone: "mute" },
  "task.purged": { label: "Deleted for good", tone: "bad", sensitive: S },
  "task.evidence_verified": { label: "Evidence verified", tone: "ok" },
  "task.evidence_rejected": { label: "Evidence rejected", tone: "warn" },
  "task_template.deleted": { label: "Template deleted", tone: "mute" },
  "project.deleted": { label: "Project deleted", tone: "bad" },
  "roster.location_created": { label: "Location added", tone: "mute" },
  "roster.location_updated": { label: "Location changed", tone: "mute" },
  "roster.location_archived": { label: "Location archived", tone: "warn" },
  "roster.supervisors_changed": { label: "Location supervisors changed", tone: "warn", sensitive: S },
  "roster.office_limit_changed": { label: "Roster manager sites limited", tone: "warn", sensitive: S },
  "roster.shift_type_created": { label: "Shift type added", tone: "mute" },
  "roster.shift_type_updated": { label: "Shift type changed", tone: "mute" },
  "roster.shift_type_archived": { label: "Shift type archived", tone: "mute" },
  "roster.targets_changed": { label: "Staffing targets changed", tone: "mute" },
  "shift.pattern_created": { label: "Shift pattern added", tone: "mute" },
  "shift.pattern_updated": { label: "Shift pattern changed", tone: "mute" },
  "shift.pattern_archived": { label: "Shift pattern archived", tone: "mute" },
  "shift.assigned": { label: "Shift assigned", tone: "mute" },
  "shift.unassigned": { label: "Shift removed", tone: "mute" },
  "shift.reporting_changed": { label: "Report duty changed", tone: "mute" },
  "shift.report.submitted": { label: "Report submitted", tone: "info" },
  "shift.report.accepted": { label: "Report reviewed", tone: "ok" },
  "shift.report.returned": { label: "Report returned", tone: "warn" },
  "report.export_requested": { label: "Report export asked", tone: "info" },
  "report.exported": { label: "Report exported", tone: "info", sensitive: S },
  "report.export_failed": { label: "Report export failed", tone: "bad" },
  "report.export_expired": { label: "Report export expired", tone: "mute" },
}

const human = (a: string) => {
  const s = a.replace(/[._]+/g, " ").trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : a
}

/** What the log shows for an action. An action the catalogue does not know (an API newer than this page) reads as a plain sentence and is not flagged. */
export function actionInfo(action: string): { label: string; tone: Tone; sensitive: boolean } {
  const i = AUDIT_ACTIONS[action]
  return i ? { label: i.label, tone: i.tone, sensitive: i.sensitive === true } : { label: human(action), tone: "mute", sensitive: false }
}
