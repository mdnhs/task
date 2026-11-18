// The browser side of settings (B6 T6.5): every write is ONE call to the API through the BFF, with the API's shapes. Errors are ApiErrors: the caller shows
// userMessage(e) (or fieldErrorOf for a form field). Nothing here keeps a secret: an enrolment code is only ever a return value.
import type { ApiClient } from "@/lib/api/client"
import { isAllowedRedirect } from "@/features/billing/redirect"
import type { DeviceAllow, DeviceFeature, DeviceOwner, DeviceType } from "@/lib/devices"
import type { MfaPolicy } from "@/lib/mfa"
import type { Access, Module } from "@/lib/types"
import { toTemplateBody, toTemplateData } from "@/lib/report-template"
import type { TemplateData } from "@opsdesk/domain/shift-report"
import { roleUuid } from "./adapters"
import { OAUTH_REDIRECT_HOSTS } from "./constants"
import type { MatrixRole, Organisation } from "./types"

export type Navigator = { go: (url: string) => void }

export function makeSettingsClient(api: ApiClient, nav: Navigator) {
  return {
    // organisation and branding
    async saveOrganisation(patch: Partial<Pick<Organisation, "name" | "timezone" | "reportDeadline">>) {
      if (Object.keys(patch).length === 0) throw new Error("settings: nothing to save")
      return api.patch("/v1/settings/organisation", { body: patch })
    },
    async saveBranding(b: { color: string; logoFileId: string | null }) {
      return api.put("/v1/settings/branding", { body: { logoFileId: b.logoFileId, primaryColor: b.color } })
    },

    // the report template (FR-M1-25): the WHOLE template is replaced; the answer is what the API holds now (department names follow a team rename, I26). Over 64 KB it throws template_too_large before any request.
    async saveReportTemplate(data: TemplateData): Promise<TemplateData> {
      return toTemplateData(await api.put("/v1/shift-reports/template", { body: toTemplateBody(data) }))
    },

    // departments are teams of kind "department"
    async createDepartment(name: string) {
      return api.post("/v1/teams", { body: { name, kind: "department" } })
    },
    async renameDepartment(id: string, name: string) {
      return api.patch("/v1/teams/{id}", { path: { id }, body: { name } })
    },
    async deleteDepartment(id: string) {
      await api.delete("/v1/teams/{id}", { path: { id } })
    },

    // roles and members: the UI holds role KEYS, the routes take uuids
    async changeRole(userId: string, roleKey: string, roles: readonly MatrixRole[]) {
      return api.patch("/v1/members/{userId}", { path: { userId }, body: { roleId: roleUuid(roles, roleKey) } })
    },
    async cloneRole(id: string, label: string) {
      return api.post("/v1/roles/{id}/clone", { path: { id }, body: { label } })
    },
    async setRoleAccess(roleId: string, module: Module, level: Access) {
      return api.patch("/v1/roles/{id}", { path: { id: roleId }, body: { access: { [module]: level } } })
    },

    // invites (the link only travels by mail: no token here)
    async invite(email: string, roleKey: string, roles: readonly MatrixRole[]) {
      return api.post("/v1/invites", { body: { email, roleId: roleUuid(roles, roleKey) } })
    },
    async resendInvite(id: string) {
      return api.post("/v1/invites/{id}/resend", { path: { id } })
    },
    async revokeInvite(id: string) {
      await api.delete("/v1/invites/{id}", { path: { id } })
    },

    /**
     * Logo upload (plans with the files module only): presigned intent, a direct PUT of the bytes to storage with exactly the headers the API signed, confirm, then wait for the
     * malware scan to finish (the branding route accepts only a CLEAN file). Resolves the clean file id; an infected or unreadable file throws.
     */
    async uploadLogo(file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, put: typeof fetch = fetch, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
      const intent = await api.post("/v1/files/uploads", { body: { name: file.name, mime: file.type, sizeBytes: file.size } })
      const res = await put(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: await file.arrayBuffer() })
      if (!res.ok) throw new Error("settings: the logo upload failed")
      await api.post("/v1/files/{id}/complete", { path: { id: intent.fileId } })
      for (let i = 0; i < 30; i++) {
        const f = await api.get("/v1/files/{id}", { path: { id: intent.fileId } })
        if (f.status === "clean") return intent.fileId
        if (f.status === "infected" || f.status === "deleted") throw new Error("settings: the logo was refused")
        await wait(1000)
      }
      throw new Error("settings: the logo scan took too long")
    },

    // devices and policies
    async registerDevice(d: { userId: string; type: DeviceType; owner: DeviceOwner; label: string; trusted: boolean }) {
      return api.post("/v1/devices", { body: d })
    },
    async setTrusted(id: string, trusted: boolean) {
      return api.patch("/v1/devices/{id}", { path: { id }, body: { trusted } })
    },
    async removeDevice(id: string) {
      await api.delete("/v1/devices/{id}", { path: { id } })
    },
    /** Issues a one-time code (15 minutes) and clears the device's current binding. The code is shown once by the caller and never stored. */
    async enrolmentCode(id: string): Promise<{ code: string; expiresAt: string }> {
      return api.post("/v1/devices/{id}/enrolment-code", { path: { id } })
    },
    async setDevicePolicy(feature: DeviceFeature, allow: DeviceAllow) {
      return api.put("/v1/device-policies/{feature}", { path: { feature }, body: { allow } })
    },
    async setMfaPolicy(policy: MfaPolicy) {
      return api.put("/v1/settings/mfa-policy", { body: policy })
    },

    // integrations: the consent URL is followed only on Google's own host
    async startGoogle(): Promise<void> {
      const { url } = await api.post("/v1/integrations/google/start")
      if (!isAllowedRedirect(url, OAUTH_REDIRECT_HOSTS)) throw new Error("settings: the consent link is not on an allowed host")
      nav.go(url)
    },
    async disconnect(id: string) {
      await api.delete("/v1/integrations/{id}", { path: { id } })
    },

    // privacy
    async requestExport() {
      return api.post("/v1/me/data-export")
    },
    async openRequest(r: { subjectUserId: string; kind: "export" | "erase" | "correct"; reason: string }) {
      return api.post("/v1/data-requests", { body: r })
    },
    async revokeGrant(id: string) {
      return api.delete("/v1/settings/support-grants/{id}", { path: { id } })
    },
  }
}
