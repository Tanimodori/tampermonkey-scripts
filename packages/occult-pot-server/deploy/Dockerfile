# The application is packed on the development machine with "rush deploy" (scenario
# "occult-pot-server", see the README); this image only installs the result — no compiler, no
# package manager, no network, no repository:
#
#     rush deploy --scenario occult-pot-server … --create-archive ../occult-pot-server.zip
#     scp deploy/occult-pot-server.zip   <host>:~/occult-pot-server/deploy/
#     unzip -oq deploy/occult-pot-server.zip -d deploy/server        # on the server
#     sudo docker compose up -d --build                              # on the server
#
# The build context is this folder (see docker-compose.yml), which is why the Dockerfile lives here.
FROM node:24-slim

ENV NODE_ENV=production
ENV OPS_SERVER_PORT=3000
WORKDIR /app

# Rush lays a deployment out the way the monorepo is organised, so the application sits under
# packages/occult-pot-server/ inside the target folder. It carries dist/ and package.json — whose
# "type": "module" is what lets node run the ESM bundle — and no node_modules, because vite inlines
# every runtime dependency.
COPY server/packages/occult-pot-server/ /app/

# The log directory the rotating file sink writes into (OPS_LOG_ROTATING_FILE_PATH). Docker creates
# a bind mount's target from the host directory, but a named volume inherits this directory's
# ownership — and the runtime user has to be able to open its file either way.
RUN mkdir -p /var/log/occult-pot-server \
 && chown node:node /var/log/occult-pot-server

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.OPS_SERVER_PORT||3000) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
