// FR-M1-31 (I27): shift-report exports are SERVER jobs. The page asks for one (`POST /v1/report-exports`), polls it (`GET /v1/report-exports/{id}`: 1 s, then 2 s, bounded, stopped when the tab
// is hidden or the user leaves) and opens the finished file through the same-origin download path with a FRESH nonce each time. The URL is built at the moment of a click and never stored
// or cached; the rows are the domain builder's (export-rows.ts). Nothing here makes a file in the browser.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"
import type { ExportFormat } from "./export-rows"

export type ExportRequest = { format: ExportFormat; reportId?: string; from?: string; to?: string; team?: string; person?: string; status?: "all" | "draft" | "submitted" | "late" | "missing" | "accepted" | "returned" }
export type ExportStatus = { id: string; status: "queued" | "running" | "done" | "failed" | "expired"; format: ExportFormat; rowCount: number | null; expiresAt: string | null; errorCode: string | null }

export type ExportOutcome =
  | { kind: "done"; id: string; status: ExportStatus }
  | { kind: "failed"; id: string; code: string | null }
  | { kind: "expired"; id: string }
  /** Polling stopped (the tab is hidden or the user left): the export keeps running, ask again with `poll`. */
  | { kind: "paused"; id: string }
  | { kind: "timeout"; id: string }

/** Copy for the end states. `failed` takes the API's `errorCode` (`forbidden` = the requester's access was reduced before the job ran). */
export const EXPORT_COPY = {
  failed: (code: string | null): string => (code === "forbidden" ? "Your access changed, so the export was not created." : "The export could not be created. Try again."),
  expired: "Expired, export again.",
  timeout: "Still working. Check back in a moment.",
  paused: "Still working. It continues when you come back.",
  /** The PDF is Latin-1 only (B5 limitation): Bengali, Arabic, Chinese and other scripts do not print in it. */
  pdfNote: "PDF supports Latin letters only. For Bengali and other scripts use CSV or Excel.",
} as const

/** The path that downloads ONE finished export: our own origin, a fresh `nonce`, no credential. The API answers it with a 60 s presigned redirect (409 export_not_ready, 404 once gone). */
export const exportPath = (id: string, nonce: string): string => `/v1/report-exports/${encodeURIComponent(id)}/download?o=${encodeURIComponent(nonce)}`

export type ExportDeps = {
  wait(ms: number): Promise<void>
  /** True while the tab is hidden. */
  hidden(): boolean
  /** Most GETs per run (the bound). */
  maxPolls?: number
}

export function makeExportClient(api: Pick<ApiClient, "get" | "post">, deps: ExportDeps) {
  const maxPolls = deps.maxPolls ?? 60

  async function poll(id: string, o: { onStatus?: (s: ExportStatus) => void; signal?: AbortSignal } = {}): Promise<ExportOutcome> {
    for (let i = 0; i < maxPolls; i++) {
      if (o.signal?.aborted || deps.hidden()) return { kind: "paused", id }
      const s = (await api.get("/v1/report-exports/{id}", { path: { id } })) as ExportStatus
      o.onStatus?.(s)
      if (s.status === "done") return { kind: "done", id, status: s }
      if (s.status === "failed") return { kind: "failed", id, code: s.errorCode }
      if (s.status === "expired") return { kind: "expired", id }
      await deps.wait(i === 0 ? 1000 : 2000)
      if (o.signal?.aborted || deps.hidden()) return { kind: "paused", id }
    }
    return { kind: "timeout", id }
  }

  return {
    poll,
    /** Ask for the export, then poll it. A refusal (422 range_too_long, export_too_large, pdf_too_large; 409 export_limit) is an ApiError for userMessage. */
    async run(body: ExportRequest, o: { onStatus?: (s: ExportStatus) => void; signal?: AbortSignal } = {}): Promise<ExportOutcome> {
      const { id } = await api.post("/v1/report-exports", { body })
      return poll(id, o)
    },
  }
}

/**
 * Open a finished export: ask the API first (a manual-redirect probe, so a refusal is read as the problem it is), then open a SECOND fresh path in a new tab. A refusal returns the ApiError
 * for the caller's mapped copy; nothing is kept.
 */
export const openExport = (id: string, o: { fetch: typeof fetch; open(url: string): void; nonce(): string }) => openFile((n) => exportPath(id, n), o)

/**
 * Open one file by path (an export or a report attachment): ask the API first (a manual-redirect probe, so a refusal is read as the problem it is), then open a SECOND fresh path. The path
 * builder takes a fresh nonce every call; nothing is kept.
 */
export async function openFile(pathOf: (nonce: string) => string, o: { fetch: typeof fetch; open(url: string): void; nonce(): string }): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await o.fetch(pathOf(o.nonce()), { redirect: "manual", credentials: "same-origin" })
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.ok) {
    o.open(pathOf(o.nonce()))
    return { ok: true }
  }
  return { ok: false, error: await ApiError.fromResponse(res) }
}
