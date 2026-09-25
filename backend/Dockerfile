# syntax=docker/dockerfile:1.7
# ATS Gem backend image. One image serves api / worker / scheduler (different commands);
# the Playwright crawler gets its own image in Phase 5.

ARG NODE_IMAGE=node:24-alpine

# ── deps: full dependency tree (build tools, Prisma CLI) ─────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
# postinstall runs `prisma generate`, which only needs the schema.
RUN npm ci

# ── build: compile TypeScript (includes the generated Prisma client) ─────────
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── migrate: one-off job that applies migrations (`prisma migrate deploy`) ───
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ── prod-deps: runtime dependencies only ─────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Fail the image build, not the first container start, if the compiled Prisma client cannot be
# loaded with the production dependencies (e.g. unresolvable import specifiers). Loads code only;
# no database connection is made.
RUN node -e "require('./dist/generated/prisma/client.js')"
# Local-driver document storage (STORAGE_LOCAL_DIR). Created here, owned by the runtime user, so a
# named volume mounted on it inherits that ownership instead of a root-owned mount point.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" >/dev/null || exit 1
CMD ["node", "dist/main.api.js"]
