ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

FROM ${NODE_IMAGE} AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /workspace

FROM pnpm-base AS build
ARG NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @event-commerce/cloud-api... build \
  && pnpm --filter @event-commerce/cloud-api --prod deploy --legacy /out/cloud-api
RUN pnpm --filter @event-commerce/event-edge... build \
  && pnpm --filter @event-commerce/event-edge --prod deploy --legacy /out/event-edge
RUN pnpm --filter @event-commerce/control-web build

FROM ${NODE_IMAGE} AS cloud-api
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

FROM ${NODE_IMAGE} AS event-edge
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

FROM ${NODE_IMAGE} AS control-web
ARG RELEASE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/ArlZ/EventcommerceOS" \
  org.opencontainers.image.revision="$RELEASE_COMMIT" \
  org.opencontainers.image.title="Event Commerce OS Control Web"
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/control-web
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/standalone /app
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
