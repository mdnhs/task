import { z } from "zod"

// An empty string in an env file ("GOOGLE_CLIENT_ID=") means "not configured".
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional())

// base64 of exactly 32 bytes (AES-256 key for stored secrets).
const secretsKey = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes").optional(),
)

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
  // Optional bootstrap mail config; the platform admin's stored settings take precedence.
  RESEND_API_KEY: optional,
  MAIL_FROM: optional,
}).refine((e) => e.NODE_ENV !== "production" || e.SECRETS_KEY, { path: ["SECRETS_KEY"], message: "required in production" })

export type Env = z.infer<typeof schema>

export function parseEnv(input: Record<string, string | undefined>): Env {
  const r = schema.safeParse(input)
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Invalid environment: ${detail}`)
  }
  return r.data
}
