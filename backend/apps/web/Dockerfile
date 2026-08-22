FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json ./
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cutz/web build

FROM base AS run
ENV NODE_ENV=production
# Next standalone output bundles only what it needs.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
