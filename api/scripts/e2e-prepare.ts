// Prepares the throwaway e2e database (docker-compose.e2e.yml): roles, migrations and the MinIO bucket. Idempotent. LOCAL ONLY.
// Refuses anything but a localhost database. Env: E2E_PG_ADMIN_URL, DATABASE_OWNER_URL, S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY.
import { readFileSync } from "node:fs"
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3"
import pg from "pg"
import { runMigrations } from "../src/db/migrate"

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set`)
  return v
}

async function main(): Promise<void> {
  const admin = need("E2E_PG_ADMIN_URL")
  const owner = need("DATABASE_OWNER_URL")
  for (const u of [admin, owner]) if (!/@(localhost|127\.0\.0\.1)[:/]/.test(u)) throw new Error("refused: the e2e database must be on localhost")
  const su = new pg.Client({ connectionString: admin })
  await su.connect()
  await su.query(readFileSync(new URL("../src/db/bootstrap/roles.sql", import.meta.url), "utf8"))
  await su.query(`ALTER ROLE app_owner LOGIN PASSWORD '${need("E2E_OWNER_PW")}'`)
  await su.query(`ALTER ROLE app_user LOGIN PASSWORD '${need("E2E_USER_PW")}'`)
  await su.end()
  await runMigrations(owner)
  const s3 = new S3Client({ endpoint: need("S3_ENDPOINT"), region: "eu-west-1", forcePathStyle: true, credentials: { accessKeyId: need("S3_ACCESS_KEY_ID"), secretAccessKey: need("S3_SECRET_ACCESS_KEY") } })
  try {
    await s3.send(new CreateBucketCommand({ Bucket: need("S3_BUCKET") }))
  } catch (e) {
    if (!/BucketAlready/.test((e as Error).name)) throw e
  } finally {
    s3.destroy()
  }
}

main().then(() => console.log("e2e stack ready"), (e) => { console.error("e2e prepare failed:", (e as Error).message); process.exit(1) })
