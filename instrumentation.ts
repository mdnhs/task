// Runs once when the Next.js server starts (before it serves a request). Production refuses to boot without APP_ORIGIN and API_URL (lib/env.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { assertServerEnv } = await import("./lib/env")
  assertServerEnv()
}
