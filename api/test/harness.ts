import { createApp, type AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { hasTestDb, testDb } from "./db"
import { fakeClock, fakeMailer, type FakeClock, type FakeMailer } from "./fakes"

export { fakeClock, fakeMailer }
export { resetDb } from "./db"

const testEnv: Deps["env"] = {
  NODE_ENV: "test",
  PORT: 0,
  DATABASE_URL: "postgres://app_user@localhost/test",
  DATABASE_OWNER_URL: "postgres://app_owner@localhost/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  APP_URL: "http://localhost:3000",
  DATA_REGION: "eu-west-1",
}

export function testApp(over: Partial<Deps> = {}): { app: AppType; deps: Deps; mailer: FakeMailer; clock: FakeClock } {
  const mailer = fakeMailer()
  const clock = fakeClock()
  const deps: Deps = {
    env: testEnv,
    // Real (lazy-connecting) Testcontainers db when global setup provided one; inert fake otherwise.
    db: hasTestDb() ? testDb() : ({ execute: async () => undefined } as never),
    auth: undefined,
    clock,
    mailer,
    ...over,
  }
  return { app: createApp(deps), deps, mailer, clock }
}

export function call(
  app: AppType,
  method: string,
  path: string,
  o: { cookie?: string; tenant?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...o.headers }
  if (o.cookie) headers.cookie = o.cookie
  if (o.tenant) headers["x-tenant"] = o.tenant
  let body: string | undefined
  if (o.body !== undefined) {
    body = JSON.stringify(o.body)
    headers["content-type"] ??= "application/json"
  }
  return Promise.resolve(app.request(path, { method, headers, body }))
}
