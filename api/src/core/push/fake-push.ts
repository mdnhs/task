import type { PushSender } from "./push"

export type SentPush = { token: string; msg: { title: string; body: string; data?: Record<string, string> } }
export type FakePush = PushSender & { sent: SentPush[] }

/** In-memory PushSender for tests: records every send. */
export function fakePush(): FakePush {
  const sent: SentPush[] = []
  return { sent, send: async (token, msg) => void sent.push({ token, msg }) }
}
