import { expect, test } from "vitest"

test("importing server does not parse env or start listening", async () => {
  const saved = { ...process.env }
  for (const k of ["DATABASE_URL", "DATABASE_OWNER_URL", "REDIS_URL", "BETTER_AUTH_SECRET", "APP_URL", "DATA_REGION"]) delete process.env[k]
  try {
    const mod = await import("./server")
    expect(typeof mod.start).toBe("function")
  } finally {
    process.env = saved
  }
})
