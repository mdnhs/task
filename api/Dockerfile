# OpsDesk API image. Build from the repo root (npm workspace monorepo):
#   docker build -f api/Dockerfile .

FROM node:22-alpine AS deps
WORKDIR /app
# Only manifests, so this layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev --ignore-scripts --include-workspace-root=false -w api -w packages/domain

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs opsdesk
COPY --from=deps --chown=opsdesk:nodejs /app/node_modules ./node_modules
COPY --chown=opsdesk:nodejs package.json ./
COPY --chown=opsdesk:nodejs api ./api
COPY --chown=opsdesk:nodejs packages/domain ./packages/domain
# Tenant defaults and role templates are data (FR-M0-20), read at runtime from /app/public/data.
COPY --chown=opsdesk:nodejs public/data/auth/onboarding-defaults.json ./public/data/auth/onboarding-defaults.json
COPY --chown=opsdesk:nodejs public/data/shell/roles.json ./public/data/shell/roles.json
USER opsdesk
WORKDIR /app/api
EXPOSE 8080
# The code is TypeScript with extensionless imports and @opsdesk/domain ships .ts source,
# so it runs under tsx (a production dependency of api) with no separate compile step.
CMD ["../node_modules/.bin/tsx", "src/server.ts"]
