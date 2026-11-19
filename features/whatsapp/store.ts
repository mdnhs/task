import { createStore } from "@/lib/store"
import { CONNECT_MS, nextConnection } from "./logic"
import type { WaChannelPrefs, WaKind, WaSelf, WaState, WaVia } from "./types"

// Client-only, in memory: survives client navigation (Settings -> Account), resets on reload. Nothing is sent anywhere.
export const waStore = createStore<WaState>()

let timer: ReturnType<typeof setTimeout> | undefined

/** Turn on: Not connected -> Connecting now, Active after CONNECT_MS (a mock delay). The timer lives here, not in a component, so leaving the page does not strand "Connecting". */
export function startConnect(at: string) {
  clearTimeout(timer)
  waStore.set((s) => ({ ...s, connection: nextConnection(s.connection, "start", at) }))
  timer = setTimeout(() => waStore.set((s) => ({ ...s, connection: nextConnection(s.connection, "ready", at) })), CONNECT_MS)
}
export function stopConnect(at: string) {
  clearTimeout(timer)
  waStore.set((s) => ({ ...s, connection: nextConnection(s.connection, "off", at) }))
}

export const setKindVia = (id: string, via: WaKind["via"]) => waStore.set((s) => ({ ...s, kinds: s.kinds.map((k) => (k.id === id && !k.locked ? { ...k, via } : k)) }))
export const setDefaultVia = (defaultVia: WaVia) => waStore.set((s) => ({ ...s, defaultVia }))
export const setSelf = (patch: Partial<WaSelf>) => waStore.set((s) => ({ ...s, self: { ...s.self, ...patch } }))
export const setSelfChannel = (kind: string, patch: Partial<WaChannelPrefs>) =>
  waStore.set((s) => ({ ...s, self: { ...s.self, channels: { ...s.self.channels, [kind]: { ...s.self.channels[kind], ...patch } } } }))
