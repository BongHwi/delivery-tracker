FROM node:20-alpine AS base
RUN npm install -g pnpm@8

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS prod-deps
WORKDIR /app
COPY . /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY . /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @delivery-tracker/server build-with-deps

FROM prod-deps
# Copy workspace configuration first
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml

# Copy all built dist folders and package.json files
COPY --from=build /app/packages/api/package.json /app/packages/api/package.json
COPY --from=build /app/packages/api/dist /app/packages/api/dist
COPY --from=build /app/packages/core/package.json /app/packages/core/package.json
COPY --from=build /app/packages/core/dist /app/packages/core/dist
COPY --from=build /app/packages/webhook/package.json /app/packages/webhook/package.json
COPY --from=build /app/packages/webhook/dist /app/packages/webhook/dist
COPY --from=build /app/packages/webhook/prisma /app/packages/webhook/prisma
COPY --from=build /app/packages/server/package.json /app/packages/server/package.json
COPY --from=build /app/packages/server/dist /app/packages/server/dist

# Re-run pnpm install to create workspace symlinks now that dist folders exist
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod

# Generate Prisma Client in production node_modules
RUN cd /app/packages/webhook && npx prisma generate

# Create data directory for SQLite and set permissions
RUN mkdir -p /data && chown -R node:node /data

WORKDIR /app/packages/server

ENV NODE_ENV=production
USER node

CMD ["pnpm", "start"]
