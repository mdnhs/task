import { apiFailureView } from "@/features/shell"

// Page reads settle to a value or an error so the page's JSX is built OUTSIDE a try/catch (react-hooks/error-boundaries). `refused` is the full-page state for a 403, else the error is rethrown to the error state.
export const settle = <T,>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }))
export function refused(e: unknown, label: string): React.ReactNode {
  const v = apiFailureView(e, label)
  if (v) return v
  throw e
}
