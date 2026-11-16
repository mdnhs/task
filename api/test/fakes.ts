export type FakeClock = {
  now(): Date
  advance(d: { minutes?: number; hours?: number; days?: number }): void
}
export function fakeClock(start = new Date("2026-11-16T09:00:00Z")): FakeClock {
  let t = start.getTime()
  return {
    now: () => new Date(t),
    advance: (d) => {
      t += ((d.days ?? 0) * 24 * 60 + (d.hours ?? 0) * 60 + (d.minutes ?? 0)) * 60_000
    },
  }
}

export type MailMsg = { to: string; subject: string; text: string }
export type FakeMailer = {
  send(msg: MailMsg): Promise<void>
  sent: MailMsg[]
  last(): MailMsg
}
export function fakeMailer(): FakeMailer {
  const sent: MailMsg[] = []
  return {
    sent,
    send: async (msg) => { sent.push(msg) },
    last: () => sent[sent.length - 1],
  }
}
