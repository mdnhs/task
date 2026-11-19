// "Add to calendar" on My roster (B8 Task 22, R8-16): the calendar file is built by the API's ONE builder (`GET /v1/roster/mine.ics`) and fetched through the BFF (same-origin /v1, the
// session cookie, the page's tenant); the browser then saves it under the name the API's Content-Disposition gives. Nothing about the shifts is computed here. Framework-free (deps injected).
import { browserGet } from "@/lib/api/browser"
import { ApiError } from "@/lib/api/problem"
import { mapRosterError, type RosterError } from "./errors"

export type Saver = (file: Blob, filename: string) => void
export type DownloadResult = { ok: true; filename: string } | { ok: false; error: RosterError }

const FALLBACK = "roster.ics"
/** The filename of an `attachment` Content-Disposition (quoted or not); the fallback when there is none. Path parts are never trusted. */
export function filenameOf(disposition: string | null): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "")
  let name = ""
  try {
    name = m?.[1] ? decodeURIComponent(m[1]).split(/[\\/]/).pop() ?? "" : ""
  } catch {
    return FALLBACK // a malformed escape (Task 22 review m5)
  }
  return /^[\w .-]{1,100}$/.test(name) ? name : FALLBACK
}

/** Saves a Blob as a download: the link has to be in the page for Firefox and Safari, and the URL must outlive the click or the download is cancelled. */
export const saveBlob: Saver = (file, filename) => {
  const url = URL.createObjectURL(file)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function downloadMyCalendar(range: { from: string; to: string }, deps: { get?: (path: string) => Promise<Response>; save?: Saver } = {}): Promise<DownloadResult> {
  const get = deps.get ?? ((p: string) => browserGet(p))
  const save = deps.save ?? saveBlob
  const q = new URLSearchParams({ from: range.from, to: range.to })
  let res: Response
  try {
    res = await get(`/v1/roster/mine.ics?${q}`)
  } catch (e) {
    return { ok: false, error: mapRosterError(e) }
  }
  if (!res.ok) return { ok: false, error: mapRosterError(await ApiError.fromResponse(res)) }
  if (!/^text\/calendar\b/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, error: mapRosterError(new Error("not a calendar")) }
  }
  const filename = filenameOf(res.headers.get("content-disposition"))
  save(new Blob([await res.arrayBuffer()], { type: "text/calendar;charset=utf-8" }), filename)
  return { ok: true, filename }
}
