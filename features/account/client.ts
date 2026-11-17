// The browser side of the account page (B6 T6.5). Errors are ApiErrors: show userMessage(e). The enrolment code is typed, sent and forgotten: never stored or logged.
import type { ApiClient } from "@/lib/api/client"
import type { PrefsBody } from "./adapters"

export function makeAccountClient(api: ApiClient) {
  return {
    async savePrefs(body: PrefsBody) {
      return api.put("/v1/me/notification-preferences", { body })
    },
    /** Binds THIS browser to a device allocated to the signed-in user (the API answers with the signed device cookie; the BFF passes it through unchanged). */
    async bindDevice(id: string, code: string) {
      return api.post("/v1/devices/{id}/bind", { path: { id }, body: { code: code.trim().toUpperCase() } })
    },
    /** The caller's OWN devices (a member without settings:write only ever gets their own). */
    async ownDevices() {
      return api.get("/v1/devices")
    },
  }
}
