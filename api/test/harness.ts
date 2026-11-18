import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import pino from "pino"
import { createApp, type AppType } from "../src/app"
import type { Deps } from "../src/deps"
import { buildAuth } from "../src/modules/auth/auth"
import { hasTestDb, testDb } from "./db"
import { fakePush, type FakePush } from "../src/core/push/fake-push"
import { fakeScanner } from "../src/core/scan/fake-scanner"
import { makeStorage } from "../src/modules/platform-storage"
import { fakeQueue, type FakeQueue } from "../src/core/queue/fake-queue"
import { fakeBilling, type FakeBillingProvider } from "../src/modules/billing"
import { fakeOAuth, type FakeOAuth } from "../src/core/oauth/fake-oauth"
import { fakeNet, type FakeNet } from "../src/core/net/fake-net"
import { fakeClock, fakeMailer, fakeRateLimiter, type FakeClock, type FakeMailer, type FakeRateLimiter } from "./fakes"

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
  // Real MinIO from global setup (TEST_S3_*); inert placeholders when the suite runs without it.
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT,
  S3_REGION: process.env.TEST_S3_REGION ?? "eu-west-1",
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? "opsdesk-test",
  S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? "test",
  S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test",
  S3_FORCE_PATH_STYLE: true,
  CLAMD_PORT: 3310,
  FILE_MAX_BYTES: 26214400,
  TASK_EVIDENCE_MAX_BYTES: 26214400,
  TASK_VIDEO_MAX_BYTES: 104857600,
  TASK_VOICE_MAX_BYTES: 3145728,
  TRUST_PROXY_HOPS: 0,
  AUTH_RATE_LIMIT_PER_MIN: 30,
}

// Lets helpers (factories.ts) find an app's fake mailer from the app alone.
export const mailerOf = new WeakMap<object, FakeMailer>()

export function testApp(over: Partial<Deps> = {}): { app: AppType; deps: Deps; mailer: FakeMailer; clock: FakeClock; queue: FakeQueue; push: FakePush; oauth: FakeOAuth; billing: FakeBillingProvider; net: FakeNet; rateLimiter: FakeRateLimiter } {
  const clock = fakeClock()
  const env = over.env ?? testEnv
  // Real (lazy-connecting) Testcontainers db when global setup provided one; inert fake otherwise.
  const db = over.db ?? (hasTestDb() ? testDb() : ({ execute: async () => undefined } as never))
  const usedClock = over.clock ?? clock
  const logger = over.logger ?? pino({ level: "silent" })
  const mailer = (over.mailer ?? fakeMailer()) as FakeMailer // the one actually used
  const queue = (over.queue ?? fakeQueue()) as FakeQueue
  const push = (over.push ?? fakePush()) as FakePush
  const oauth = (over.oauth ?? fakeOAuth()) as FakeOAuth
  const billing = (over.billing ?? fakeBilling()) as FakeBillingProvider
  const net = (over.net ?? fakeNet()) as FakeNet
  const rateLimiter = (over.rateLimiter ?? fakeRateLimiter(usedClock)) as FakeRateLimiter
  const storage = over.storage ?? makeStorage({ env, db })
  const scanner = over.scanner ?? fakeScanner() // auto: flags EICAR, everything else clean
  const deps: Deps = { env, db, clock: usedClock, mailer, logger, queue, push, storage, scanner, oauth, billing, net, rateLimiter, auth: over.auth ?? buildAuth({ env, db, clock: usedClock, mailer, logger, rateLimiter }) }
  const app = createApp(deps)
  mailerOf.set(app, mailer)
  return { app, deps, mailer, clock: usedClock as FakeClock, queue, push, oauth, billing, net, rateLimiter }
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

/**
 * Browser-redirect callbacks: authenticated by session only (no X-Tenant exists on a redirect); the tenant comes from the
 * single-use state, and forced MFA is enforced there (integrations.test.ts covers it). Not "tenant routes" for the MFA sweep.
 */
const CALLBACKS = new Set(["/v1/integrations/google/callback"])

/** GET routes from the OpenAPI document that have no path params, minus /v1/me*, /v1/auth/providers (the one public, tenant-less route: a future route under /v1/auth is walked), /v1/platform/* (platform staff, not tenant routes) and the spec itself (R6). */
export function tenantGetRoutes(app: AppType): string[] {
  const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } })
  return Object.entries(doc.paths ?? {})
    .filter(([path, item]) => "get" in (item ?? {}) && !path.includes("{") && !path.startsWith("/v1/me") && path !== "/v1/auth/providers" && !path.startsWith("/v1/platform/") && path !== "/v1/openapi.json" && !CALLBACKS.has(path))
    .map(([path]) => path)
    .sort()
}

/** Writes an object straight into the test bucket (simulates a client that bypassed the intent, or a replaced object). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = new S3Client({
    region: testEnv.S3_REGION,
    endpoint: testEnv.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: testEnv.S3_ACCESS_KEY_ID!, secretAccessKey: testEnv.S3_SECRET_ACCESS_KEY! },
  })
  try {
    await client.send(new PutObjectCommand({ Bucket: testEnv.S3_BUCKET, Key: key, Body: body, ContentType: contentType }))
  } finally {
    client.destroy()
  }
}
