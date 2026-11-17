// Creating a task is up to THREE calls (B6 ruling I13): POST /v1/tasks, then PUT /repeat (the API's create takes no repeat), then PUT /voice-note. They are not atomic: once the
// task exists it STAYS whatever happens next, and a later failure is reported ("Set repeat again") without ever creating a second task.
export type Step<T> = { ok: true; value: T } | { ok: false }
export type Created = { id: string; version: number; ref: string }

export type FlowResult<T extends Created> = { task: T; repeat: "none" | "ok" | "failed"; voice: "none" | "ok" | "failed" } | null

export async function createFlow<T extends Created>(steps: { create(): Promise<Step<T>>; repeat?(t: T): Promise<Step<T>>; voice?(t: T): Promise<Step<T>> }): Promise<FlowResult<T>> {
  const made = await steps.create()
  if (!made.ok) return null // nothing was created
  let task = made.value
  let repeat: "none" | "ok" | "failed" = "none"
  let voice: "none" | "ok" | "failed" = "none"
  if (steps.repeat) {
    const r = await steps.repeat(task)
    repeat = r.ok ? "ok" : "failed"
    if (r.ok) task = r.value // the answer carries the NEW version the voice note needs
  }
  if (steps.voice) {
    const v = await steps.voice(task)
    voice = v.ok ? "ok" : "failed"
  }
  return { task, repeat, voice }
}
