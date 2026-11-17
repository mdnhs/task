export class AppError extends Error {
  /** `extra`: machine-readable members merged into the problem body (e.g. `errors` of a 422 report_invalid). Never user free text. */
  constructor(public status: number, public code: string, public title: string, public extra?: Record<string, unknown>) {
    super(code)
  }
}
export const NotFound = (code = "not_found") => new AppError(404, code, "Not Found")
export const Forbidden = (code: string) => new AppError(403, code, "Forbidden")
export const Unauthorized = (code: string) => new AppError(401, code, "Unauthorized")
export const Conflict = (code: string) => new AppError(409, code, "Conflict")

export type ProblemBody = { type: string; title: string; status: number; code: string; requestId: string }

export function problem(status: number, code: string, title: string, requestId: string, extra?: Record<string, unknown>): Response {
  const body: ProblemBody & Record<string, unknown> = { ...extra, type: "about:blank", title, status, code, requestId }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId },
  })
}

const HTTP_CODES: Record<number, string> = {
  400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
  413: "payload_too_large", 415: "unsupported_media_type", 429: "too_many_requests",
}
const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  413: "Payload Too Large", 415: "Unsupported Media Type", 429: "Too Many Requests",
}

export const statusCode = (status: number): string => HTTP_CODES[status] ?? "http_error"
export const statusTitle = (status: number): string => STATUS_TITLES[status] ?? "Error"
