# Build stage: use the repo's own pinned Rush + pnpm so the lockfile and workspace
# resolution match CI exactly.
FROM node:24-slim AS build

ENV CI=true
WORKDIR /repo

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

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.OPS_SERVER_PORT||3000) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
