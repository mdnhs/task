#!/bin/sh
# One-shot migration step of a deploy. Runs INSIDE the api image (the compose `migrate` service, profile ops), as app_owner, with the NEW image:
#   docker compose -f deploy/docker-compose.prod.yml --profile ops run --rm migrate
# It needs DATABASE_OWNER_URL only. It never reads DATABASE_URL: app_user cannot create tables. A session advisory lock inside scripts/migrate.ts makes
# it a single runner, and drizzle applies all pending migrations in ONE transaction (a failure leaves the database at its previous version).
# Take and verify a backup BEFORE this step: .claude/docs/deploy/migrations.md.
set -eu
: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is not set (the app_owner connection string)}"
cd /app/api
exec ../node_modules/.bin/tsx scripts/migrate.ts
