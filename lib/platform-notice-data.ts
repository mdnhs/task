import { getData } from "./data"
import { activeNotice, type PlatformNotice } from "./platform-notice"

// Server only (reads the mock JSON). Settings saved in the platform console live in its client store only in this mock,
// so tenants see the seed's announcement (public/data/platform/settings.json); a backend would persist the console's save.
export async function getPlatformNotice(now: string): Promise<PlatformNotice | null> {
  return activeNotice(await getData<{ announcement: PlatformNotice | null }>("platform/settings.json"), now)
}
