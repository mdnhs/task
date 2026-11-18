// The editor's draft session (B6 T6.7 fix, ruling O1): the form, the debounced autosave and the idempotent submit, with one rule for a 409 version_conflict: the user's text is NEVER
// discarded. The server's report is fetched and held as `conflict`; the user then chooses "Keep mine" (continue on the server's new version, the local text is saved) or "Reload theirs"
// (the form takes the server data). While a conflict is open nothing is sent and a submit waits for the choice (so there is no second stale-version 409 and no second reload).
// Idempotency (F7) is unchanged: one request id per attempt, kept across a retry, new after a final refusal such as this conflict.
import { classifyApiError } from "@/lib/api/problem"
import { makeAutosaver, makeSubmitter, type ReportsClient } from "./client"
import type { ShiftReport } from "./types"

export type SessionSnapshot = { form: ShiftReport; conflict: ShiftReport | null }
export type SubmitResult = { kind: "ok"; report: ShiftReport } | { kind: "conflict" } | { kind: "choose" } | { kind: "unsaved" }

export type SessionOptions = {
  client: Pick<ReportsClient, "saveDraft" | "get" | "submit">
  report: ShiftReport
  delay?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
  newId?: () => string
  onChange(s: SessionSnapshot): void
  /** An autosave failed (not a conflict): once per failure streak. */
  onError(e: unknown): void
}

export function makeDraftSession(o: SessionOptions) {
  let form = o.report
  let conflict: ShiftReport | null = null
  let failing = false
  const emit = () => o.onChange({ form, conflict })
  const fetchConflict = async () => {
    try {
      conflict = await o.client.get(o.report.reportId ?? "")
    } catch (e) {
      o.onError(e)
    }
    emit()
  }
  const auto = makeAutosaver<ShiftReport, ShiftReport>({
    delay: o.delay ?? 800,
    version: o.report.version,
    setTimer: o.setTimer,
    clearTimer: o.clearTimer,
    save: (f, v) => o.client.saveDraft({ ...f, version: v }),
    onSaved: () => {
      failing = false
    },
    onConflict: () => void fetchConflict(),
    onError: (e) => {
      if (failing) return
      failing = true
      o.onError(e)
    },
  })
  const submitter = makeSubmitter({ submit: (r, id) => o.client.submit(r, id) }, o.newId)

  return {
    snapshot: (): SessionSnapshot => ({ form, conflict }),
    edit(next: ShiftReport) {
      form = next
      auto.schedule(next)
      emit()
    },
    /** Save what is pending now; false when the last save failed or a conflict is waiting for the user. */
    async flush(): Promise<boolean> {
      await auto.flush()
      return !failing && !auto.isStopped()
    },
    async keepMine() {
      if (!conflict) return
      const v = conflict.version
      conflict = null
      auto.schedule(form)
      auto.keep(v)
      emit()
      await auto.flush()
    },
    reloadTheirs() {
      if (!conflict) return
      form = conflict
      conflict = null
      auto.resume(form.version)
      emit()
    },
    async submit(): Promise<SubmitResult> {
      if (conflict || auto.isStopped()) return { kind: "choose" }
      if (!(await this.flush())) return auto.isStopped() ? { kind: "choose" } : { kind: "unsaved" }
      try {
        return { kind: "ok", report: await submitter.submit({ ...form, version: auto.version() }) }
      } catch (e) {
        if (classifyApiError(e).kind !== "version_conflict") throw e
        await fetchConflict()
        return { kind: "conflict" }
      }
    },
    /** Leaving the page: save what is pending (unless a conflict waits). */
    leave: () => void auto.flush(),
  }
}

export type DraftSession = ReturnType<typeof makeDraftSession>
