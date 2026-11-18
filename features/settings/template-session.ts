// The report template editor's save session (B7 ruling S6): every change shows at once and ONE save (500 ms after the last change) replaces the whole template under
// `If-Match`. A 412 (someone saved first) is NEVER overwritten and never reverted silently: the banner "Changed by someone else" shows, edits are ignored and nothing is sent until
// the user chooses Reload, which fetches the server copy and its new ETag (single-flight: a double click is one fetch). Any other refusal reverts to what the API holds.
import { classifyApiError } from "@/lib/api/problem"
import type { TemplateWithEtag } from "@/lib/report-template"
import type { TemplateData } from "./types"

type Departments = TemplateData["departments"]
/** "stale": the banner (a 412); "unavailable": the banner after a Reload that could not load the server copy (try again). */
export type TemplateSnapshot = { depts: Departments; conflict: "none" | "stale" | "unavailable"; reloading: boolean }

export type TemplateSessionOptions = {
  client: { saveReportTemplate(data: TemplateData, etag: string | null): Promise<TemplateWithEtag>; loadReportTemplate(): Promise<TemplateWithEtag> }
  data: TemplateData
  etag: string | null
  delay?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
  onChange(s: TemplateSnapshot): void
  /** A save was accepted; `note` says what changed. */
  onSaved(note: string): void
  /** A save was refused for any reason except a 412 (that is the banner's job). The form is back on what the API holds. */
  onRefused(e: unknown): void
}

export function makeTemplateSession(o: TemplateSessionOptions) {
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let depts = o.data.departments
  let known = o.data.departments
  let etag = o.etag
  let note = ""
  let conflict: TemplateSnapshot["conflict"] = "none"
  let reloading: Promise<void> | null = null
  let timer: unknown
  let saving = false
  let again = false
  const snapshot = (): TemplateSnapshot => ({ depts, conflict, reloading: reloading !== null })
  const emit = () => o.onChange(snapshot())

  async function saveOnce(body: Departments): Promise<TemplateWithEtag> {
    try {
      return await o.client.saveReportTemplate({ departments: body }, etag)
    } catch (e) {
      if (classifyApiError(e).kind !== "retry") throw e
      return o.client.saveReportTemplate({ departments: body }, etag) // 409 retry: the same request once more
    }
  }

  async function flush(): Promise<void> {
    if (saving) {
      again = true
      return
    }
    saving = true
    try {
      do {
        again = false
        const body = depts
        try {
          const r = await saveOnce(body)
          known = r.data.departments
          etag = r.etag
          if (!again) depts = r.data.departments
          emit()
          o.onSaved(note)
        } catch (e) {
          again = false
          if (classifyApiError(e).kind === "version_conflict") {
            conflict = "stale" // keep what is on screen, send nothing until Reload
          } else {
            depts = known
            o.onRefused(e)
          }
          emit()
        }
      } while (again)
    } finally {
      saving = false
    }
  }

  return {
    snapshot,
    /** A change from the user: ignored while the conflict banner is open (nothing silently wins), else shown now and saved after the debounce. */
    edit(fn: (d: Departments) => Departments, what: string): void {
      if (conflict !== "none") return
      depts = fn(depts)
      note = what
      emit()
      clearTimer(timer)
      timer = setTimer(() => void flush(), o.delay ?? 500)
    },
    /** Fetch the server copy and its ETag; the form takes it. One fetch however many clicks. */
    reload(): Promise<void> {
      if (reloading) return reloading
      clearTimer(timer)
      reloading = (async () => {
        try {
          const r = await o.client.loadReportTemplate()
          depts = known = r.data.departments
          etag = r.etag
          conflict = "none"
        } catch {
          conflict = "unavailable"
        } finally {
          reloading = null
          emit()
        }
      })()
      emit()
      return reloading
    },
    dispose(): void {
      clearTimer(timer)
    },
  }
}

export type TemplateSession = ReturnType<typeof makeTemplateSession>
