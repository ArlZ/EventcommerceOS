SHELL := /bin/sh

.PHONY: dev infra-up infra-down db-migrate check android-check

infra-up:
	docker compose -f infra/docker-compose.yml up -d

infra-down:
	docker compose -f infra/docker-compose.yml down

db-migrate:
	pnpm --filter @event-commerce/cloud-api db:migrate

dev: infra-up db-migrate
	pnpm --filter './packages/**' build
	pnpm --parallel --filter @event-commerce/cloud-api --filter @event-commerce/event-edge --filter @event-commerce/control-web dev

check:
	pnpm build
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm format:check
	pnpm arch:check

android-check:
	gradle -p apps/pos-android testDebugUnitTest lintDebug
