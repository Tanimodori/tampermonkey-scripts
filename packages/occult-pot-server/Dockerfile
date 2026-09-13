# Build stage: use the repo's own pinned Rush + pnpm so the lockfile and workspace
# resolution match CI exactly.
FROM node:24-slim AS build

# The mirrors this build uses. TUNA and npmmirror, because the delivery builds in mainland China:
# against the stock hosts a single `apt-get update` took over six minutes and the pnpm phase many.
# Both are build arguments, so a build elsewhere can point them back at the official ones:
#
#     docker compose build --build-arg APT_MIRROR=deb.debian.org --build-arg NPM_MIRROR=registry.npmjs.org
#
# Hosts, not URLs: the schemes are the ones each tool needs (apt over http, npm always https).
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG NPM_MIRROR=registry.npmmirror.com

ENV CI=true
WORKDIR /repo

# git: Rush inspects the checked-out repo through it ("Error calculating the state of the repo" without
# it). ca-certificates: for git over TLS. Both are build-stage only; the runtime image has neither.
#
# http, not https, for the mirror: `ca-certificates` is one of the packages this very step installs, so
# an https source could not be verified yet. The container image's apt configuration is DEB822
# (`/etc/apt/sources.list.d/debian.sources`) — only its URIs are rewritten, so the codename and the
# signing key stay the image's own; the traditional path is handled too, in case a base image switches
# back. Pipeline-Depth=0 is TUNA's own advice for its nginx's occasional "Connection reset by peer".
RUN set -eux; \
    for file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      if [ -f "$file" ]; then sed -i -E "s|https?://deb\.debian\.org|http://${APT_MIRROR}|g" "$file"; fi; \
    done; \
    apt-get update -o Acquire::Retries=3 -o Acquire::http::Pipeline-Depth=0; \
    apt-get install -y --no-install-recommends git ca-certificates; \
    rm -rf /var/lib/apt/lists/*

# npmmirror for everything npm touches *before* the project's own configuration is in scope:
# `install-run-rush.js` fetches Rush with `npm install` inside a temp folder (so the repo's
# `common/config/rush/.npmrc` is not read), and Rush then fetches pnpm into `~/.rush`. A user-level
# `.npmrc` is what covers both; the project file covers everything after it.
RUN printf 'registry=https://%s/\n' "$NPM_MIRROR" > /root/.npmrc

COPY . .

# The project's own registry file, from the same build argument: Rush copies it to
# `common/temp/.npmrc` before pnpm runs, so without this the pnpm phase would ignore the argument and
# always use the committed default. Between the two, one `--build-arg NPM_MIRROR=…` moves every
# download in this stage.
RUN sed -i "s|^registry=.*|registry=https://${NPM_MIRROR}/|" common/config/rush/.npmrc

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
