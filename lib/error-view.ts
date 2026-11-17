// What an error boundary may show (B6 T6.5): short mapped copy and a reference, NEVER the thrown message or stack. Pure: no React, no Next.
// An ApiError (a client-side API failure) keeps its own copy and request id; anything else is a server render error whose message Next already hides in production,
// and whose `digest` is the reference an operator can match to the server log. A network failure (TypeError from fetch) reads as "No connection".
import { ApiError, classifyApiError, userMessage } from "./api/problem"

export function errorView(error: unknown): { text: string; ref: string | null } {
  if (error instanceof ApiError) return userMessage(error)
  const { kind } = classifyApiError(error)
  const digest = typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string" ? (error as { digest: string }).digest : ""
  const text = kind === "network" ? userMessage(error).text : "Something went wrong. Try again."
  return { text, ref: digest || null }
}
