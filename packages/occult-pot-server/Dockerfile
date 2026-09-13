# Build stage: use the repo's own pinned Rush + pnpm so the lockfile and workspace
# resolution match CI exactly.
FROM node:24-slim AS build

ENV CI=true
WORKDIR /repo

# Rush inspects the checked-out repo through git ("Error calculating the state of the repo" without
# it) and fetches the pnpm store over TLS. Both are build-stage only: the runtime image has neither.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY . .

# Installs exactly what common/config/rush/pnpm-lock.yaml pins (no lockfile rewrite).
RUN node common/scripts/install-run-rush.js install \
 && node common/scripts/install-run-rush.js build --to occult-pot-server

# Runtime stage: vite bundles every runtime dependency (ssr.noExternal), so the
# self-contained dist/ is all the runtime image needs.
FROM node:24-slim AS runtime

ENV NODE_ENV=production
ENV OPS_SERVER_PORT=3000
WORKDIR /app

COPY --from=build /repo/packages/occult-pot-server/dist ./dist

# The log directory the file sink writes into (OPS_LOG_ROTATING_FILE_PATH). Docker creates a bind
# mount's target from the host directory, but a named volume inherits this directory's ownership —
# and the runtime user has to be able to open its file either way.
RUN mkdir -p /var/log/occult-pot-server \
 && chown node:node /var/log/occult-pot-server

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.OPS_SERVER_PORT||3000) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
