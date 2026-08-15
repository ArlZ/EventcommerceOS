# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ARG APP_FILTER
ARG RELEASE_COMMIT
ARG NEXT_PUBLIC_CLOUD_API_URL=http://localhost:3001

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_PUBLIC_CLOUD_API_URL=$NEXT_PUBLIC_CLOUD_API_URL
ENV RELEASE_COMMIT=$RELEASE_COMMIT

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY prettier.config.mjs eslint.config.mjs tsconfig.base.json ./

RUN test -n "$APP_FILTER"
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "$APP_FILTER"... build

FROM node:22-bookworm-slim AS runtime

ARG APP_FILTER
ARG RELEASE_COMMIT

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV APP_FILTER=$APP_FILTER
ENV RELEASE_COMMIT=$RELEASE_COMMIT

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY --from=build --chown=node:node /app /app

USER node

CMD ["sh", "-c", "exec pnpm --filter \"$APP_FILTER\" start"]
