ARG RUNTIME_TARGET=control-web
ARG NODE_IMAGE=node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

FROM pnpm-base AS build
ARG NEXT_PUBLIC_CLOUD_API_URL
ARG RELEASE_COMMIT
ENV CI=true
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
ENV RELEASE_COMMIT=$RELEASE_COMMIT
RUN node -e "const value=process.env.NEXT_PUBLIC_CLOUD_API_URL?.trim(); if(!value) throw new Error('NEXT_PUBLIC_CLOUD_API_URL is required for production image builds'); const parsed=new URL(value); if(parsed.protocol!=='https:' || parsed.origin!==value) throw new Error('NEXT_PUBLIC_CLOUD_API_URL must be a canonical HTTPS origin without credentials, path, query or fragment');"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Build the full workspace surface before pruning deployable packages. pnpm deploy
# may reconcile production node_modules state, so interleaving deploys with later
# workspace builds can make a non-interactive Docker build attempt a modules purge.
RUN pnpm --filter @event-commerce/cloud-api... build \
  && pnpm --filter @event-commerce/event-edge... build \
  && HOSTINGER_APP_TARGET=container pnpm --filter @event-commerce/control-web build
RUN pnpm --filter @event-commerce/cloud-api --prod deploy --legacy /out/cloud-api
RUN pnpm --filter @event-commerce/event-edge --prod deploy --legacy /out/event-edge

FROM ${NODE_IMAGE} AS runtime-base
# The pinned Node image predates Alpine's fix for CVE-2026-14456. Keep the
# reproducible Node base while requiring the stable v3.24 OpenSSL libraries at
# or above the vendor-fixed version before any runtime image can be produced.
RUN apk add --no-cache --upgrade \
  'libcrypto3>=3.5.8-r0' \
  'libssl3>=3.5.8-r0' \
  && rm -rf \
  /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack \
  /usr/local/bin/pnpm \
  /usr/local/bin/pnpx \
  /usr/local/bin/yarn \
  /usr/local/bin/yarnpkg \
  /opt/yarn-v1.22.22

FROM runtime-base AS cloud-api
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/ArlZ/EventcommerceOS" \
  org.opencontainers.image.revision="$RELEASE_COMMIT" \
  org.opencontainers.image.title="Event Commerce OS Cloud API"
ENV NODE_ENV=production
ENV PORT=3001
ENV RELEASE_COMMIT=$RELEASE_COMMIT
WORKDIR /app
COPY --from=build --chown=node:node /out/cloud-api ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime-base AS event-edge
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/ArlZ/EventcommerceOS" \
  org.opencontainers.image.revision="$RELEASE_COMMIT" \
  org.opencontainers.image.title="Event Commerce OS Event Edge"
ENV NODE_ENV=production
ENV PORT=3002
ENV RELEASE_COMMIT=$RELEASE_COMMIT
WORKDIR /app
COPY --from=build --chown=node:node /out/event-edge ./
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime-base AS control-web
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/ArlZ/EventcommerceOS" \
  org.opencontainers.image.revision="$RELEASE_COMMIT" \
  org.opencontainers.image.title="Event Commerce OS Control Web"
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV RELEASE_COMMIT=$RELEASE_COMMIT
WORKDIR /app/apps/control-web
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/standalone /app
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# Render builds a Dockerfile without selecting a named target. The Blueprint
# supplies RUNTIME_TARGET as a build argument and runtime environment value.
# Keep Render's exact-release guard in executable wrappers so Render can use
# the image CMD directly instead of parsing a compound dockerCommand string.
# Existing CI continues to build the hardened named stages with --target.
FROM ${RUNTIME_TARGET} AS render-runtime
COPY --chown=node:node --chmod=0555 infra/render/pilot/start.sh /usr/local/bin/render-start
COPY --chown=node:node --chmod=0555 infra/render/pilot/migrate.sh /usr/local/bin/render-migrate
CMD ["/usr/local/bin/render-start"]
