import { readFileSync } from "node:fs"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers"
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3"
import pg from "pg"
import { runMigrations } from "../src/db/migrate"

let container: StartedPostgreSqlContainer | undefined
let redis: StartedTestContainer | undefined
let minio: StartedTestContainer | undefined

// Same image as docker-compose.dev.yml: minio/minio is gone from Docker Hub, Chainguard builds the same server.
const MINIO_IMAGE = "cgr.dev/chainguard/minio:latest"
const MINIO_USER = "minio_test_user"
const MINIO_PW = "minio_test_secret_pw"
const BUCKET = "opsdesk-test"

const OWNER_PW = "owner_test_pw"
const USER_PW = "user_test_pw"

// Test-only table with the standard RLS template (never in production migrations).
const PROBE_SQL = `
CREATE TABLE rls_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, label text NOT NULL);
ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rls_probe USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
`

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("postgres:16").start()
  const su = new pg.Client({ connectionString: container.getConnectionUri() })
  await su.connect()
  await su.query(readFileSync(new URL("../src/db/bootstrap/roles.sql", import.meta.url), "utf8"))
  await su.query(`ALTER ROLE app_owner LOGIN PASSWORD '${OWNER_PW}'`)
  await su.query(`ALTER ROLE app_user LOGIN PASSWORD '${USER_PW}'`)
  await su.end()

  const url = (u: string, pw: string) =>
    `postgres://${u}:${pw}@${container!.getHost()}:${container!.getPort()}/${container!.getDatabase()}`
  const ownerUrl = url("app_owner", OWNER_PW)
  await runMigrations(ownerUrl)
  const owner = new pg.Client({ connectionString: ownerUrl })
  await owner.connect()
  await owner.query(PROBE_SQL)
  await owner.end()

  redis = await new GenericContainer("redis:7")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start()
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`

  minio = await new GenericContainer(MINIO_IMAGE)
    .withCommand(["server", "/data"])
    .withEnvironment({ MINIO_ROOT_USER: MINIO_USER, MINIO_ROOT_PASSWORD: MINIO_PW })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000))
    .start()
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
  const s3 = new S3Client({ endpoint, region: "eu-west-1", forcePathStyle: true, credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PW } })
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  s3.destroy()
  process.env.TEST_S3_ENDPOINT = endpoint
  process.env.TEST_S3_REGION = "eu-west-1"
  process.env.TEST_S3_BUCKET = BUCKET
  process.env.TEST_S3_ACCESS_KEY_ID = MINIO_USER
  process.env.TEST_S3_SECRET_ACCESS_KEY = MINIO_PW

  process.env.TEST_DATABASE_URL = url("app_user", USER_PW)
  process.env.TEST_DATABASE_OWNER_URL = ownerUrl
}

export async function teardown(): Promise<void> {
  await minio?.stop()
  await redis?.stop()
  await container?.stop()
}
