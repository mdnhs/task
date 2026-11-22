// The browser side of settings (B6 T6.5): every write is ONE call to the API through the BFF, with the API's shapes. Errors are ApiErrors: the caller shows
// userMessage(e) (or fieldErrorOf for a form field). Nothing here keeps a secret: an enrolment code is only ever a return value.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"
import { brandAssetMime, type BrandAssetKind } from "@/lib/branding"
import { isAllowedRedirect } from "@/features/billing/redirect"
import type { DeviceAllow, DeviceFeature, DeviceOwner, DeviceType } from "@/lib/devices"
import type { MfaPolicy } from "@/lib/mfa"
import type { Access, Module } from "@/lib/types"
import { fetchTemplate, putTemplate, type TemplateWithEtag } from "@/lib/report-template"
import type { TemplateData } from "@opsdesk/domain/shift-report"
import { roleUuid } from "./adapters"
import { OAUTH_REDIRECT_HOSTS } from "./constants"
import type { Branding, MatrixRole, Organisation } from "./types"

export type Navigator = { go: (url: string) => void }

export type UploadStage = "uploading" | "checking" | "scanning" | "saving"
/** PUTs the bytes to the presigned URL with exactly the signed headers; `onProgress` gets 0..1. */
export type PutFn = (url: string, init: { headers: Record<string, string>; body: ArrayBuffer }, onProgress?: (p: number) => void) => Promise<{ ok: boolean }>
export type UploadOptions = { put?: PutFn; wait?: (ms: number) => Promise<void>; onStage?: (s: UploadStage) => void; onProgress?: (p: number) => void }

/** The browser's PUT with upload progress (fetch has none). Content-Length is set by the browser from the body, so it is not sent as a header. */
const xhrPut: PutFn = (url, init, onProgress) =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open("PUT", url)
    for (const [k, v] of Object.entries(init.headers)) if (k.toLowerCase() !== "content-length") x.setRequestHeader(k, v)
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    x.onload = () => resolve({ ok: x.status >= 200 && x.status < 300 })
    x.onerror = () => reject(new Error("settings: the upload failed"))
    x.send(init.body)
  })

export function makeSettingsClient(api: ApiClient, nav: Navigator) {
  return {
    // organisation and branding
    async saveOrganisation(patch: Partial<Pick<Organisation, "name" | "timezone" | "reportDeadline">>) {
      if (Object.keys(patch).length === 0) throw new Error("settings: nothing to save")
      return api.patch("/v1/settings/organisation", { body: patch })
    },
    async saveBranding(b: { color: string }) {
      return api.put("/v1/settings/branding", { body: { primaryColor: b.color } })
    },

    // the report template (FR-M1-25): the WHOLE template is replaced; the answer is what the API holds now (department names follow a team rename, I26). Over 64 KB it throws template_too_large before any request.
    // It carries the ETag the edit started from as If-Match: 412 means someone else saved first (ruling S6); the answer holds the new tag.
    async saveReportTemplate(data: TemplateData, etag: string | null): Promise<TemplateWithEtag> {
      return putTemplate(api, data, etag)
    },
    async loadReportTemplate(): Promise<TemplateWithEtag> {
      return fetchTemplate(api)
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
    /** B8 Task 24: deactivate (409 last_owner | already_deactivated, 422 self_deactivation) and reactivate (409 seat_limit | not_deactivated); the API's answer is the row's new status. */
    async deactivate(userId: string) {
      return api.post("/v1/members/{userId}/deactivate", { path: { userId } })
    },
    async reactivate(userId: string) {
      return api.post("/v1/members/{userId}/reactivate", { path: { userId } })
    },
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
     * Organization logo or favicon: presigned intent, a direct PUT of the bytes to storage with exactly the headers the API signed (progress is reported), confirm (the API checks the real
     * bytes and refuses anything but the allowed raster formats), wait for the malware scan to finish, then make it live. Resolves the branding the API holds now. A refusal is an ApiError
     * with the API's code (image_*, file_infected, storage_not_configured...); the caller shows brandAssetProblem(kind, code).
     */
    async uploadBrandAsset(kind: BrandAssetKind, file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, o: UploadOptions = {}): Promise<Branding> {
      const mime = brandAssetMime(kind, file)
      if (!mime) throw new Error("settings: unsupported image type")
      const { put = xhrPut, wait = (ms) => new Promise((r) => setTimeout(r, ms)), onStage, onProgress } = o
      onStage?.("uploading")
      const intent = await api.post("/v1/settings/branding/{kind}/uploads", { path: { kind }, body: { name: file.name, mime, sizeBytes: file.size } })
      const res = await put(intent.upload.url, { headers: intent.upload.headers, body: await file.arrayBuffer() }, onProgress)
      if (!res.ok) throw new Error("settings: the upload failed")
      onStage?.("checking")
      await api.post("/v1/settings/branding/{kind}/uploads/{fileId}/complete", { path: { kind, fileId: intent.fileId } })
      onStage?.("scanning")
      for (let i = 0; i < 60; i++) {
        const st = await api.get("/v1/settings/branding/{kind}/uploads/{fileId}", { path: { kind, fileId: intent.fileId } })
        if (st.status === "infected") throw new ApiError(410, "file_infected")
        if (st.status === "clean") {
          onStage?.("saving")
          return api.put("/v1/settings/branding/{kind}", { path: { kind }, body: { fileId: intent.fileId } })
        }
        await wait(1000)
      }
      throw new Error("settings: the scan took too long")
    },
    /** Removes the live logo or favicon (its file is deleted). */
    async removeBrandAsset(kind: BrandAssetKind): Promise<Branding> {
      return api.delete("/v1/settings/branding/{kind}", { path: { kind } })
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
