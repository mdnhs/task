// Runs once when the Next.js server starts (before it serves a request): production refuses to boot with an invalid environment (instrumentation-node.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./instrumentation-node")).checkServerEnvAtBoot()
}
