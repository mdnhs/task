// One place for the throwaway e2e stack (docker-compose.e2e.yml): ports, fake credentials, the API and web environments.
// Everything here is local demo data. No live provider is configured: no Stripe, Resend or R2 keys exist in this process tree.
// The ports are overridable (E2E_*_PORT) so a second e2e stack can run beside the default one (docker-compose.e2e.yml reads the same names); the defaults are the documented ones.
const port = (k: string, d: number): number => Number(process.env[k] || d)
export const API_PORT = port("E2E_API_PORT", 3101)
export const WEB_PORT = port("E2E_WEB_PORT", 3100)
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
export const API_ORIGIN = `http://localhost:${API_PORT}`
// The web reaches the API through e2e/slow-api.mjs (a transparent proxy; it only delays answers when a skeleton test asks).
export const PROXY_PORT = port("E2E_PROXY_PORT", 3102)
export const PROXY_ORIGIN = `http://localhost:${PROXY_PORT}`
export const PLATFORM_TOTP = "e2eplatformtotpsecret0123456789"
export const PLATFORM_EMAIL = "platform.owner@demo.example"
export const DEMO_PASSWORD = "e2e-demo-password-12"
const PG_PORT = port("E2E_PG_PORT", 55432)
export const PG_ADMIN = `postgres://postgres:postgres@localhost:${PG_PORT}/opsdesk_e2e`
export const OWNER_URL = `postgres://app_owner:e2e_owner_pw@localhost:${PG_PORT}/opsdesk_e2e`
export const USER_URL = `postgres://app_user:e2e_user_pw@localhost:${PG_PORT}/opsdesk_e2e`
export const PERSONAS = {
  owner: "amara.bello@demo.example", // all scope; roster level office: every site (docs/deploy/demo-seed.md, Rosters)
  platform: PLATFORM_EMAIL, // the console operator (2FA enrolled by the seed); signs in with a TOTP code
  ops: "lilianna.novak@demo.example", // all-scope manager; roster level office in the demo tenant: edits the roster of every site
  supervisor: "daniel.okafor@demo.example", // Security team manager; roster supervisor of Docklands Plaza only
  supervisor2: "grace.mensah@demo.example", // Cleaning team manager
  auditor: "ibrahim.khan@demo.example", // read-only everywhere
  hr: "priya.shah@demo.example",
  admin: "rhys.edwards@demo.example",
  member: "tomasz.wojcik@demo.example", // Cleaning, reports to Grace
  member2: "marcus.hill@demo.example", // Security, reports to Daniel
  kone: "amara.kone@demo.example", // Cleaning employee: the person CR-04 reassigns a task to
  leo: "leo.fernandez@demo.example", // CR-06: the member with the bound Android phone
  ismail: "ismail.rahman@demo.example", // the fifth member of the all-day pattern: the one the conflict walk edits; roster supervisor of Coppers only (rosters walk)
  haddad: "m.haddad@demo.example", // unassigned Security employees: the people CR-01 and CR-03 give a shift to
  silva: "j.silva@demo.example",
  kowalski: "a.kowalski@demo.example",
} as const
export type Persona = keyof typeof PERSONAS
export const S3 = { endpoint: `http://localhost:${port("E2E_MINIO_PORT", 59000)}`, bucket: "opsdesk-e2e", key: "e2eminio", secret: "e2eminio-secret" }

export const apiEnv = {
  NODE_ENV: "development", // http on localhost: the device cookie is `od-device-*` (see playwright.config.ts)
  PORT: String(API_PORT),
  DATABASE_URL: USER_URL,
  DATABASE_OWNER_URL: OWNER_URL,
  REDIS_URL: `redis://localhost:${port("E2E_REDIS_PORT", 56379)}`,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
  APP_URL: WEB_ORIGIN,
  DATA_REGION: "eu-west-1",
  SECRETS_KEY: Buffer.alloc(32, 9).toString("base64"),
  S3_ENDPOINT: S3.endpoint,
  S3_REGION: "eu-west-1",
  S3_BUCKET: S3.bucket,
  S3_ACCESS_KEY_ID: S3.key,
  S3_SECRET_ACCESS_KEY: S3.secret,
  S3_FORCE_PATH_STYLE: "true",
  CLAMD_HOST: "localhost",
  CLAMD_PORT: String(port("E2E_CLAMD_PORT", 53310)),
  AUTH_RATE_LIMIT_PER_MIN: "1000", // every e2e persona signs in from one address
  // Keep any developer credentials out of this tree.
  RESEND_API_KEY: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  ALLOW_DEMO_SEED: "1",
  // The seed creates platform.owner@<domain> (2FA enrolled with this raw key) only when this is set: the console walk signs in with it. Fake, local, never a real secret.
  SEED_PLATFORM_TOTP_SECRET: PLATFORM_TOTP,
  E2E_PG_ADMIN_URL: PG_ADMIN,
  E2E_OWNER_PW: "e2e_owner_pw",
  E2E_USER_PW: "e2e_user_pw",
  SEED_DEMO_PASSWORD: DEMO_PASSWORD,
} as const

export const webEnv = {
  API_URL: PROXY_ORIGIN,
  APP_ORIGIN: WEB_ORIGIN,
  ENABLE_MOCK_MODULES: "",
} as const
