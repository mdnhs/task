import { getData } from "./data"
import { mockEnabled } from "./mock-registry"
import { activeNotice, type PlatformNotice } from "./platform-notice"

// MOCK (B6 I16, T6.8): the platform announcement has no API (the console's settings routes are email, storage and billing only), so a real tenant must never see the seed's
// announcement (public/data/platform/settings.json). It is shown only on a demo deployment (ENABLE_MOCK_MODULES=1). Server only (reads the mock JSON).
export async function getPlatformNotice(now: string): Promise<PlatformNotice | null> {
  if (!mockEnabled()) return null
  return activeNotice(await getData<{ announcement: PlatformNotice | null }>("platform/settings.json"), now)
}
