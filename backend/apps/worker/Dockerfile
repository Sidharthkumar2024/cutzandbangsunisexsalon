FROM node:22-alpine AS base
RUN corepack enable
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cutz/db exec prisma generate
RUN pnpm --filter @cutz/db build \
  && pnpm --filter @cutz/types build \
  && pnpm --filter @cutz/queue build \
  && pnpm --filter @cutz/providers build \
  && pnpm --filter @cutz/worker build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
