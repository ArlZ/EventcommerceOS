ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

FROM ${NODE_IMAGE} AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /workspace

FROM pnpm-base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @event-commerce/cloud-api... build \
  && pnpm --filter @event-commerce/cloud-api --prod deploy --legacy /out/cloud-api
RUN pnpm --filter @event-commerce/event-edge... build \
  && pnpm --filter @event-commerce/event-edge --prod deploy --legacy /out/event-edge
RUN pnpm --filter @event-commerce/control-web build

FROM ${NODE_IMAGE} AS cloud-api
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out/cloud-api ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM ${NODE_IMAGE} AS event-edge
ENV NODE_ENV=production
ENV PORT=3002
WORKDIR /app
COPY --from=build --chown=node:node /out/event-edge ./
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]

FROM ${NODE_IMAGE} AS control-web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/control-web
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/standalone /app
COPY --from=build --chown=node:node /workspace/apps/control-web/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
