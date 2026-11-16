import pino from "pino"
import { createApp, type AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { buildAuth } from "../src/modules/auth/auth"
import { hasTestDb, testDb } from "./db"
import { fakeQueue, type FakeQueue } from "../src/core/queue/fake-queue"
import { fakeClock, fakeMailer, type FakeClock, type FakeMailer } from "./fakes"

export { fakeClock, fakeMailer }
export { resetDb } from "./db"

export const testEnv: Deps["env"] = {
  NODE_ENV: "test",
  PORT: 0,
  DATABASE_URL: "postgres://app_user@localhost/test",
  DATABASE_OWNER_URL: "postgres://app_owner@localhost/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  APP_URL: "http://localhost:3000",
  DATA_REGION: "eu-west-1",
  // Fixed test-only key (32 bytes of 0x07), never a real secret.
  SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
}

// Lets helpers (factories.ts) find an app's fake mailer from the app alone.
export const mailerOf = new WeakMap<object, FakeMailer>()

export function testApp(over: Partial<Deps> = {}): { app: AppType; deps: Deps; mailer: FakeMailer; clock: FakeClock; queue: FakeQueue } {
  const clock = fakeClock()
  const env = over.env ?? testEnv
  // Real (lazy-connecting) Testcontainers db when global setup provided one; inert fake otherwise.
  const db = over.db ?? (hasTestDb() ? testDb() : ({ execute: async () => undefined } as never))
  const usedClock = over.clock ?? clock
  const logger = over.logger ?? pino({ level: "silent" })
  const mailer = (over.mailer ?? fakeMailer()) as FakeMailer // the one actually used
  const queue = (over.queue ?? fakeQueue()) as FakeQueue
  const deps: Deps = { env, db, clock: usedClock, mailer, logger, queue, auth: over.auth ?? buildAuth({ env, db, clock: usedClock, mailer, logger }) }
  const app = createApp(deps)
  mailerOf.set(app, mailer)
  return { app, deps, mailer, clock: usedClock as FakeClock, queue }
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

/** GET routes from the OpenAPI document that have no path params, minus /v1/me* and the spec itself (R6). */
export function tenantGetRoutes(app: AppType): string[] {
  const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } })
  return Object.entries(doc.paths ?? {})
    .filter(([path, item]) => "get" in (item ?? {}) && !path.includes("{") && !path.startsWith("/v1/me") && path !== "/v1/openapi.json")
    .map(([path]) => path)
    .sort()
}
