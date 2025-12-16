FROM --platform=linux/amd64 node:20-alpine AS base
RUN apk add --no-cache openssl
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

FROM base AS final
WORKDIR /app

# Copy workspace configuration and root package.json
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=build /app/package.json /app/package.json

# Copy all package.json files first
COPY --from=build /app/packages/api/package.json /app/packages/api/package.json
COPY --from=build /app/packages/core/package.json /app/packages/core/package.json
COPY --from=build /app/packages/webhook/package.json /app/packages/webhook/package.json
COPY --from=build /app/packages/server/package.json /app/packages/server/package.json

# Install production dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# Copy built dist folders
COPY --from=build /app/packages/api/dist /app/packages/api/dist
COPY --from=build /app/packages/core/dist /app/packages/core/dist
COPY --from=build /app/packages/webhook/dist /app/packages/webhook/dist
COPY --from=build /app/packages/webhook/prisma /app/packages/webhook/prisma
COPY --from=build /app/packages/server/dist /app/packages/server/dist

# Generate Prisma Client in production node_modules
RUN cd /app/packages/webhook && npx prisma@5.22.0 generate

# Create data directory for SQLite and set permissions
RUN mkdir -p /data && chown -R node:node /data

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/packages/server

ENV NODE_ENV=production

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["pnpm", "start"]
