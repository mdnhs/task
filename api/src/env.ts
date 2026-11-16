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
  // File storage (S3-compatible: AWS S3 leaves S3_ENDPOINT unset; MinIO/R2 set it and usually S3_FORCE_PATH_STYLE=true).
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: z.preprocess(unsetIfEmpty, z.enum(["true", "false"]).default("false").transform((v) => v === "true")),
  // Malware scanner (clamd INSTREAM over TCP).
  CLAMD_HOST: optional,
  CLAMD_PORT: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(65535).default(3310)),
  // Upper bound for one uploaded file (default 25 MiB); a per-plan limit can only lower it.
  FILE_MAX_BYTES: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).default(26214400)),
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
  if (e.NODE_ENV === "production") {
    for (const k of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLAMD_HOST"] as const) {
      if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "required in production" })
    }
  }
})

export type Env = z.infer<typeof schema>

export function parseEnv(input: Record<string, string | undefined>): Env {
  const r = schema.safeParse(input)
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Invalid environment: ${detail}`)
  }
  return r.data
}
