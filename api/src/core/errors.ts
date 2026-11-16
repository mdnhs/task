export class AppError extends Error {
  constructor(public status: number, public code: string, public title: string) {
    super(code)
  }
}
export const NotFound = (code = "not_found") => new AppError(404, code, "Not Found")
export const Forbidden = (code: string) => new AppError(403, code, "Forbidden")
export const Unauthorized = (code: string) => new AppError(401, code, "Unauthorized")
export const Conflict = (code: string) => new AppError(409, code, "Conflict")

export type ProblemBody = { type: string; title: string; status: number; code: string; requestId: string }

export function problem(status: number, code: string, title: string, requestId: string): Response {
  const body: ProblemBody = { type: "about:blank", title, status, code, requestId }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId },
  })
}
