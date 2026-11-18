# OpsDesk API image. Build from the repo root (npm workspace monorepo):
#   docker build -f api/Dockerfile .                       -> the API (stage `run`, the LAST stage, so it is what a plain build gives)
#   docker build -f api/Dockerfile --target seed .         -> the DEMO SEED image (never the default, see below)
# Stage order matters: Docker builds the last stage when no --target is given, so `run` stays last and `seed` can never be picked by accident.

FROM node:22-alpine AS deps
WORKDIR /app
# Only manifests, so this layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev --ignore-scripts --include-workspace-root=false -w api -w packages/domain

# Shared by `seed` and `run`: the same dependencies and code (tsx is a production dependency of api, so the seed needs nothing extra). No CMD here on purpose.
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs opsdesk
COPY --from=deps --chown=opsdesk:nodejs /app/node_modules ./node_modules
COPY --chown=opsdesk:nodejs package.json ./
COPY --chown=opsdesk:nodejs api ./api
COPY --chown=opsdesk:nodejs packages/domain ./packages/domain
# The mock JSON under public/data is DATA the API reads at runtime (tenant defaults and role templates, FR-M0-20; plans and entitlements) and what the demo
# seed (npm -w api run seed:demo) loads. None of it is secret, so the whole folder is copied.
COPY --chown=opsdesk:nodejs public/data ./public/data
USER opsdesk
WORKDIR /app/api

# DEMO DATA ONLY. A one-shot job image: it loads the mock data as three demo tenants and exits. It is built only with an explicit `--target seed` (compose: `build.target: seed`),
# nothing else in this file builds on it, and it is NOT the default target. It sets no opt-in, password or database URL: the operator supplies ALLOW_DEMO_SEED=1, SEED_DEMO_PASSWORD,
# DATABASE_URL (and DATABASE_OWNER_URL for a re-run or --reset) at run time, and the script still refuses a database that holds any other tenant (.claude/docs/deploy/demo-seed.md).
# Flags (for example --reset) go in a full `command: ["../node_modules/.bin/tsx", "scripts/seed-demo.ts", "--reset"]`.
FROM app AS seed
LABEL org.opencontainers.image.title="opsdesk-demo-seed" \
      com.opsdesk.purpose="demo-seed" \
      com.opsdesk.warning="demo data only; never deploy as the API"
CMD ["../node_modules/.bin/tsx", "scripts/seed-demo.ts"]

# The API (default target: keep this the LAST stage).
FROM app AS run
EXPOSE 8080
# Liveness only (GET /healthz). Readiness (GET /readyz) is the compose healthcheck that Dokploy's traffic switch waits for; the worker service overrides this
# with its Redis heartbeat check (deploy/docker-compose.prod.yml).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
# The code is TypeScript with extensionless imports and @opsdesk/domain ships .ts source,
# so it runs under tsx (a production dependency of api) with no separate compile step.
# Default process: the HTTP API. The same image runs the background worker (BullMQ jobs + the 1 s events.relay job)
# with a command override, e.g. docker-compose / Dokploy:  command: ["../node_modules/.bin/tsx", "src/worker.ts"]
# The worker handles SIGTERM gracefully (drains the current job, closes Redis and Postgres).
CMD ["../node_modules/.bin/tsx", "src/server.ts"]
