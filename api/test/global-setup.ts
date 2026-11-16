import { readFileSync } from "node:fs"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { runMigrations } from "../src/db/migrate"

let container: StartedPostgreSqlContainer | undefined

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

  process.env.TEST_DATABASE_URL = url("app_user", USER_PW)
  process.env.TEST_DATABASE_OWNER_URL = ownerUrl
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
