// Boot-time validation of the web server's environment (B6 T6.3 carry-in M6). Run once from instrumentation.ts when the server starts,
// so a production deployment without APP_ORIGIN (or API_URL) fails at boot with a clear message instead of refusing every write at request time.
// Dev, test and `next build` are never blocked. Values are never printed: only the variable names and the expected shape.

type Env = Record<string, string | undefined>

const isHttpOrigin = (v: string | undefined): boolean => {
  if (!v?.trim()) return false
  try {
    const u = new URL(v.trim())
    return (u.protocol === "http:" || u.protocol === "https:") && u.username === "" && u.password === "" && v.trim() === u.origin
  } catch {
    return false
  }
}
const isHttpUrl = (v: string | undefined): boolean => {
  if (!v?.trim()) return false
  try {
    const u = new URL(v.trim())
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/** What is wrong with the environment, as short messages (empty when fine). Only production is strict. */
export function serverEnvProblems(env: Env = process.env): string[] {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return []
  const out: string[] = []
  if (!isHttpOrigin(env.APP_ORIGIN)) out.push("APP_ORIGIN must be the public web origin as scheme://host[:port] (no path, no trailing slash), for example https://app.example.com")
  if (!isHttpUrl(env.API_URL)) out.push("API_URL must be the API's internal http(s) address, for example http://api:3001")
  return out
}

/** Throws a boot error when the production environment is incomplete. */
export function assertServerEnv(env: Env = process.env): void {
  const problems = serverEnvProblems(env)
  if (problems.length) throw new Error(`Invalid server environment: ${problems.join("; ")}.`)
}
