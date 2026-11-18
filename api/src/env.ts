import { z } from "zod"
import { parseKeyMap } from "./core/crypto/secret-box"

// An empty string in an env file ("GOOGLE_CLIENT_ID=") means "not configured".
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional())

// base64 of exactly 32 bytes (AES-256 key for stored secrets).
const secretsKey = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes").optional(),
)

const unsetIfEmpty = (v: unknown) => (v === "" ? undefined : v)

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.preprocess((v) => (v === "" ? Number.NaN : v), z.coerce.number().int().min(1).max(65535)).default(8787),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().min(1),
  // NFR-02: EU data residency only
  DATA_REGION: z.enum(["eu-west-1", "eu-central-1"]),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  // Tenant Google Drive integration (T2.4): its OWN OAuth client, separate from the sign-in client above. Required only
  // when the integration is used (start answers 503 integration_not_configured otherwise); empty = unset.
  GOOGLE_INTEGRATION_CLIENT_ID: optional,
  GOOGLE_INTEGRATION_CLIENT_SECRET: optional,
  // Exact redirect URI registered at Google; defaults to `${APP_URL}/v1/integrations/google/callback`.
  GOOGLE_INTEGRATION_REDIRECT_URI: optional,
  MICROSOFT_CLIENT_ID: optional,
  MICROSOFT_CLIENT_SECRET: optional,
  SECRETS_KEY: secretsKey,
  // Optional keyring for rotation: JSON {"<kid>": "<base64 32 bytes>"}; SECRETS_KEY_ID picks the current one.
  // When absent, SECRETS_KEY is the single key with id "k1".
  SECRETS_KEYS: optional,
  SECRETS_KEY_ID: optional,
  // Optional bootstrap mail config; the platform admin's stored settings take precedence.
  RESEND_API_KEY: optional,
  MAIL_FROM: optional,
  // File storage BOOTSTRAP fallback (production uses Cloudflare R2 settings stored by the platform admin; these also drive
  // MinIO in tests). R2: S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com, S3_REGION=auto, S3_FORCE_PATH_STYLE=true.
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: z.preprocess(unsetIfEmpty, z.enum(["true", "false"]).default("false").transform((v) => v === "true")),
  // Payment provider BOOTSTRAP fallback (the platform admin's stored billing settings win). Unconfigured: billing routes and the webhook answer 503.
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  // Malware scanner (clamd INSTREAM over TCP).
  CLAMD_HOST: optional,
  CLAMD_PORT: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(65535).default(3310)),
  // Upper bound for one uploaded file (default 25 MiB); a per-plan limit can only lower it.
  FILE_MAX_BYTES: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).default(26214400)),
  // Task upload limits per deployment (ruling D19): evidence files (25 MiB), evidence video (100 MiB), voice notes (3 MiB).
  TASK_EVIDENCE_MAX_BYTES: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).default(26214400)),
  TASK_VIDEO_MAX_BYTES: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).default(104857600)),
  TASK_VOICE_MAX_BYTES: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).default(3145728)),
  // Reverse proxies in front of the API that APPEND the caller address to x-forwarded-for (ruling S3). The client is the entry this many from the right;
  // 0 ignores the header and uses the socket address. Default: 1 in production, 0 elsewhere.
  // Auth endpoints (sign-in, sign-up, password reset, TOTP verify) per client IP per minute, shared across instances in Redis. Not a switch to turn limiting off.
  AUTH_RATE_LIMIT_PER_MIN: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(100000).default(30)),
  TRUST_PROXY_HOPS: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(0).max(10).optional()),
}).superRefine((e, ctx) => {
  if (e.SECRETS_KEYS) {
    try {
      const map = parseKeyMap(e.SECRETS_KEYS)
      if (!e.SECRETS_KEY_ID || !Object.hasOwn(map, e.SECRETS_KEY_ID)) {
        ctx.addIssue({ code: "custom", path: ["SECRETS_KEY_ID"], message: "must name a key in SECRETS_KEYS" })
      }
    } catch (err) {
      ctx.addIssue({ code: "custom", path: ["SECRETS_KEYS"], message: (err as Error).message })
    }
  } else if (e.SECRETS_KEY_ID) {
    ctx.addIssue({ code: "custom", path: ["SECRETS_KEY_ID"], message: "requires SECRETS_KEYS" })
  }
  if (e.NODE_ENV === "production" && !e.SECRETS_KEY && !e.SECRETS_KEYS) {
    ctx.addIssue({ code: "custom", path: ["SECRETS_KEY"], message: "required in production (or SECRETS_KEYS)" })
  }
  if (e.NODE_ENV === "production" && e.AUTH_RATE_LIMIT_PER_MIN > 300) {
    ctx.addIssue({ code: "custom", path: ["AUTH_RATE_LIMIT_PER_MIN"], message: "at most 300 in production (a higher value is no limit)" })
  }
  if (e.NODE_ENV === "production") {
    // S3_* are only a bootstrap fallback: the platform admin configures R2 in the DB (storage fails closed with 503 otherwise)
    for (const k of ["CLAMD_HOST"] as const) {
      if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "required in production" })
    }
  }
}).transform((e) => ({ ...e, TRUST_PROXY_HOPS: e.TRUST_PROXY_HOPS ?? (e.NODE_ENV === "production" ? 1 : 0) }))

export type Env = z.infer<typeof schema>

export function parseEnv(input: Record<string, string | undefined>): Env {
  const r = schema.safeParse(input)
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Invalid environment: ${detail}`)
  }
  return r.data
}
