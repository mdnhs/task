"use client"

// The page's task writes (B6 ruling I10): optimistic, versioned, server wins.
//  - `tasks` is the SERVER's list with a small overlay of predicted tasks on top. The overlay lives only until fresh server data arrives (any router.refresh() gives a new
//    `server` array) or the write fails (rollback), so a refusal leaves no lie on screen and the record on screen is always the server's after the answer;
//  - every write goes through useApiAction: ONE request per `key:taskId`, 409 retry repeated once, the mapped copy and a Ref on every refusal, router.refresh() after every answer;
//  - success is announced only AFTER the API said yes (never before): `ok` is what the caller (and ActionButton) reads.
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

import { apiBrowser } from "@/lib/api/browser"
import { useApiAction } from "@/hooks/use-api-action"
import { toTask } from "./adapters"
import { makeTasksClient, type TasksClient } from "./client"
import { clearFrom, emptyOverlay, predictInto, viewOf, type Overlay } from "./overlay"
import type { Task } from "./types"

/** The server list plus the predicted tasks (pure rules in overlay.ts). Pure React state: no store, nothing survives a refresh. */
export function useTaskOverlay(server: readonly Task[]) {
  const [ov, setOv] = useState<Overlay>(() => emptyOverlay(server))
  const tasks = useMemo(() => viewOf(server, ov), [server, ov])
  const predict = useCallback((id: string, next: Task) => setOv((o) => predictInto(o, server, id, next)), [server])
  const clear = useCallback((id: string) => setOv((o) => clearFrom(o, id)), [])
  return { tasks, predict, clear }
}

export type WriteOpts<T> = {
  /** The optimistic prediction (the pure rules in mutations.ts). Omit for a write the UI cannot predict. */
  predict?: (t: Task) => Task
  request: (c: TasksClient) => Promise<T>
  /** Shown after the API said yes. */
  success?: string | ((value: T) => string)
  /** The caller showed this refusal itself (under a field): no toast. */
  handled?: (e: unknown) => boolean
}

export function useTaskWrites(server: readonly Task[], client: TasksClient = makeTasksClient(apiBrowser), nameOf?: (id: string) => string) {
  const run = useApiAction()
  const { tasks, predict, clear } = useTaskOverlay(server)

  /** Resolves true only when the API accepted the write. */
  const write = useCallback(
    async <T,>(task: Task, key: string, o: WriteOpts<T>): Promise<boolean> => {
      if (!task.id) throw new Error("tasks: a write needs the task id")
      const id = task.id
      if (o.predict) predict(id, o.predict(task))
      const r = await run(`${key}:${id}`, () => o.request(client), { rollback: () => clear(id), handled: o.handled })
      if (r.ok) {
        // Most writes answer with the task itself: show exactly that (and its NEW version) at once, so a second write before the refresh lands is not sent with a stale version.
        try {
          if (r.value && typeof r.value === "object" && "version" in r.value && "ref" in r.value) predict(id, { ...toTask(r.value, { nameOf }), notes: task.notes })
        } catch {
          /* not a task answer: the refresh brings the record */
        }
        if (o.success) toast.success(typeof o.success === "function" ? o.success(r.value) : o.success)
      }
      return r.ok
    },
    [client, clear, predict, run, nameOf],
  )
  /** A write that is not about one task (create, a project, a template). */
  const act = useCallback(
    async <T,>(key: string, request: (c: TasksClient) => Promise<T>, o: { success?: string; handled?: (e: unknown) => boolean } = {}): Promise<{ ok: true; value: T } | { ok: false }> => {
      const r = await run(key, () => request(client), { handled: o.handled })
      if (r.ok && o.success) toast.success(o.success)
      return r.ok ? { ok: true, value: r.value } : { ok: false }
    },
    [client, run],
  )
  return { tasks, write, act, client }
}
