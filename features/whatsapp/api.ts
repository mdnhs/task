import { getData } from "@/lib/data"
import { toState } from "./adapters"
import type { WaState } from "./types"

// MOCK (no backend yet): reads the seed in public/data/whatsapp/*.json. Callers sit behind mockEnabled() / mockGate(); with the flag off nothing here is called.
// Swap getData() for the real API calls when it exists; the shapes in ./types stay.
export async function getWhatsApp(): Promise<WaState> {
  const [connection, kinds, people, messages, templates, countries, self] = await Promise.all([
    getData<unknown>("whatsapp/connection.json"), getData<unknown>("whatsapp/kinds.json"), getData<unknown>("whatsapp/people.json"), getData<unknown>("whatsapp/messages.json"),
    getData<unknown>("whatsapp/templates.json"), getData<unknown>("whatsapp/countries.json"), getData<unknown>("whatsapp/self.json"),
  ])
  return toState({ connection, kinds, people, messages, templates, countries, self })
}
