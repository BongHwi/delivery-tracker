# Implementation Plan: Carrier Name Field + Production Webhook System

## Executive Summary

This plan covers two features:
1. **Feature 1**: Add human-readable `name` field to Carrier type (simple, low-risk)
2. **Feature 2**: Add production-ready webhook system with SQLite + Prisma, Bull + Redis (complex, requires new infrastructure)

**User Choices:**
- Database: SQLite + Prisma
- Job Queue: Bull + Redis
- Scope: Full production-ready implementation

The plan follows a phased approach prioritizing backward compatibility and minimal disruption to the existing stateless architecture.

---

## PHASE 1: Feature 1 - Add Carrier Name Field

### 1.1 Core Changes

**File: `/packages/core/src/core/interfaces.ts`**
- Add abstract getter to Carrier class:
  ```typescript
  public abstract get carrierId(): string;
  public abstract get name(): string;  // NEW
  ```

**Files: All 33 carrier implementations**
- Add `readonly name` property to each Carrier class
- Example:
  ```typescript
  class LotteGlobalLogistics extends Carrier {
    readonly carrierId = "kr.lotte";
    readonly name = "Lotte Global Logistics";  // NEW
  }
  ```

**Carrier name mapping (33 carriers):**
- cn.cainiao.global → "Cainiao Global"
- de.dhl → "DHL"
- jp.sagawa → "Sagawa Express"
- jp.yamato → "Yamato Transport"
- kr.actcore.ocean-inbound → "Actcore Ocean Inbound"
- kr.chunilps → "Chunil Express"
- kr.cjlogistics → "CJ Logistics"
- kr.coupangls → "Coupang Logistics"
- kr.cvsnet → "CVSnet"
- kr.cway → "CWay Express"
- kr.daesin → "Daesin Logistics"
- kr.epantos → "Epantos"
- kr.epost → "Korea Post"
- kr.epost.ems → "Korea Post EMS"
- kr.goodstoluck → "Goodstoluck"
- kr.hanjin → "Hanjin Express"
- kr.homepick → "Homepick"
- kr.honamlogis → "Honam Logistics"
- kr.ilyanglogis → "Ilyang Logis"
- kr.kdexp → "Kyungdong Express"
- kr.kunyoung → "Kunyoung Express"
- kr.logen → "Logen"
- kr.lotte → "Lotte Global Logistics"
- kr.lotte.global → "Lotte Global Logistics International"
- kr.ltl → "LTL"
- kr.slx → "SLX"
- kr.todaypickup → "Today Pickup"
- kr.yongmalogis → "Yongma Logis"
- nl.tnt → "TNT"
- un.upu.ems → "UPU EMS"
- us.fedex → "FedEx"
- us.ups → "UPS"
- us.usps → "USPS"

### 1.2 GraphQL API Changes

**File: `/packages/api/src/schema/schema.graphql`**
```graphql
type Carrier {
  id: ID!
  name: String!  # NEW
}
```

**File: `/packages/api/src/resolvers/carrier.ts`**
```typescript
function carrierNameResolver(
  parent: Carrier,
  args: undefined,
  contextValue: { appContext: AppContext },
  info: GraphQLResolveInfo
): string {
  return parent.name;
}

const CarrierResolvers = {
  id: carrierIdResolver,
  name: carrierNameResolver,  // NEW
};
```

### 1.3 Build & Test
- Run `pnpm --filter @delivery-tracker/api build`
- Verify GraphQL query works

---

## PHASE 2: Feature 2 - Webhook Infrastructure Setup

### 2.1 Package Structure

**Create new package: `packages/webhook`**
```
packages/webhook/
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.ts
│   ├── webhook-service/
│   │   ├── WebhookService.ts
│   │   ├── WebhookRepository.ts
│   │   └── WebhookValidator.ts
│   ├── jobs/
│   │   ├── TrackingMonitorJob.ts
│   │   ├── WebhookDeliveryJob.ts
│   │   └── ExpirationCleanupJob.ts
│   ├── queue/
│   │   └── QueueManager.ts
│   ├── errors.ts
│   └── logger.ts
└── dist/
```

### 2.2 Database Schema (Prisma)

**File: `/packages/webhook/prisma/schema.prisma`**
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("WEBHOOK_DATABASE_URL")
}

model WebhookRegistration {
  id              String   @id @default(uuid())
  carrierId       String
  trackingNumber  String
  callbackUrl     String
  expirationTime  DateTime
  createdAt       DateTime @default(now())
  active          Boolean  @default(true)

  // For change detection
  lastChecksum    String?
  lastCheckedAt   DateTime?

  // Metadata
  deliveryAttempts Int     @default(0)
  lastDeliveryAt   DateTime?
  lastError        String?

  @@index([carrierId, trackingNumber])
  @@index([expirationTime])
  @@index([active, lastCheckedAt])
}

model WebhookDeliveryLog {
  id                    String   @id @default(uuid())
  webhookRegistrationId String
  attemptNumber         Int
  statusCode            Int?
  success               Boolean
  errorMessage          String?
  requestBody           String
  responseBody          String?
  deliveredAt           DateTime @default(now())

  @@index([webhookRegistrationId])
  @@index([deliveredAt])
}
```

### 2.3 Dependencies

**File: `/packages/webhook/package.json`**
```json
{
  "name": "@delivery-tracker/webhook",
  "private": true,
  "type": "commonjs",
  "dependencies": {
    "@delivery-tracker/core": "workspace:*",
    "@prisma/client": "^5.8.0",
    "bull": "^4.12.0",
    "ioredis": "^5.3.2",
    "luxon": "^3.4.0",
    "winston": "^3.8.2",
    "zod": "^3.21.4",
    "undici": "^6.3.0"
  },
  "devDependencies": {
    "prisma": "^5.8.0",
    "@types/luxon": "^3.3.1"
  },
  "scripts": {
    "build": "prisma generate && tsc -p .",
    "build-with-deps": "pnpm --filter '@delivery-tracker/core' build-with-deps && pnpm build",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate"
  }
}
```

### 2.4 Job Queue Architecture

**Three Queue Types:**

1. **Tracking Monitor Queue** (`tracking-monitor`)
   - Check TrackInfo for changes every 5 minutes
   - Compute checksum (SHA-256 of events array)
   - If changed: enqueue delivery job

2. **Webhook Delivery Queue** (`webhook-delivery`)
   - Send HTTP POST to callbackUrl
   - Retry logic: 1min, 5min, 15min, 1hr (max 4 attempts)
   - Record all attempts in WebhookDeliveryLog

3. **Expiration Cleanup Queue** (`expiration-cleanup`)
   - Deactivate expired webhooks every 1 hour
   - Cron: `0 * * * *`

### 2.5 Change Detection Strategy

**Checksum approach:**
- Compute SHA-256 hash of `JSON.stringify(trackInfo.events)`
- Store in `WebhookRegistration.lastChecksum`
- Only track changes in events array (sender/recipient rarely change)

---

## PHASE 3: GraphQL Mutation Integration

### 3.1 GraphQL Schema Update

**File: `/packages/api/src/schema/schema.graphql`**
```graphql
type Mutation {
  registerTrackWebhook(input: RegisterTrackWebhookInput!): Boolean
}

input RegisterTrackWebhookInput {
  carrierId: ID!
  trackingNumber: String!
  callbackUrl: String!
  expirationTime: DateTime!
}
```

### 3.2 Mutation Resolver

**File: `/packages/api/src/resolvers/webhook.ts`** (NEW)
```typescript
async function registerTrackWebhookResolver(
  parent: undefined,
  args: schema.MutationRegisterTrackWebhookArgs,
  contextValue: { appContext: AppContext },
  info: GraphQLResolveInfo
): Promise<boolean> {
  const { webhookService } = contextValue.appContext;

  if (!webhookService) {
    throw new GraphQLError("Webhook service not available", {
      extensions: { code: schema.ErrorCode.Internal },
    });
  }

  await webhookService.registerWebhook(args.input);
  return true;
}
```

### 3.3 Update AppContext

**File: `/packages/api/src/AppContext.ts`**
```typescript
interface AppContext {
  carrierRegistry: CarrierRegistry;
  webhookService?: WebhookService;  // Optional
}
```

---

## PHASE 4: Server Integration

### 4.1 Server Initialization

**File: `/packages/server/src/index.ts`**
```typescript
// NEW: Initialize webhook service (optional, env-gated)
let webhookService: WebhookService | undefined;
if (process.env.ENABLE_WEBHOOKS === "true") {
  const queueManager = new QueueManager();
  await queueManager.init({
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
  });

  webhookService = new WebhookService({
    databaseUrl: process.env.WEBHOOK_DATABASE_URL ?? "file:./webhook.db",
    carrierRegistry,
    queueManager,
  });
  await webhookService.init();
}

const appContext: AppContext = {
  carrierRegistry,
  webhookService,
};
```

### 4.2 Environment Variables

**File: `/packages/server/.env.example`** (NEW)
```bash
ENABLE_WEBHOOKS=false
WEBHOOK_DATABASE_URL=file:./webhook.db
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## PHASE 5: Docker & Deployment

### 5.1 Production Dockerfile Updates

**File: `/Dockerfile`**
```dockerfile
# Add Prisma generation step
RUN pnpm --filter @delivery-tracker/webhook db:generate

# Copy webhook package
COPY --from=build /app/packages/webhook/dist /app/packages/webhook/dist
COPY --from=build /app/packages/webhook/node_modules/.prisma /app/packages/webhook/node_modules/.prisma

# Create data directory for SQLite
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
```

### 5.2 Docker Compose for Production

**File: `/docker-compose.yml`** (NEW)
```yaml
version: '3.8'

services:
  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - ENABLE_WEBHOOKS=true
      - WEBHOOK_DATABASE_URL=file:/data/webhook.db
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    volumes:
      - webhook-data:/data
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  webhook-data:
  redis-data:
```

---

## PHASE 6: Error Handling & Logging

### 6.1 Retry & Failure Handling

**Delivery failure scenarios:**

1. **Network timeout** (30s) → Retry with exponential backoff
2. **HTTP 4xx** → Retry once, then manual review
3. **HTTP 5xx** → Full retry (4 attempts), then deactivate webhook
4. **Carrier API failures** → Skip cycle, reschedule normally (don't count as webhook failure)

### 6.2 Logging Strategy

- Use winston logger with module: "webhook"
- Log levels:
  - `info`: Registration, successful deliveries
  - `warn`: Failed attempts (before exhaustion)
  - `error`: Exhausted retries, database errors
  - `debug`: Checksum comparisons

---

## PHASE 7: Testing Strategy

### 7.1 Unit Tests

- Verify all 33 carriers have `name` property
- Webhook registration validation
- Checksum comparison and change detection
- Retry logic
- Error handling

### 7.2 Integration Tests

1. End-to-end webhook flow
2. Expiration handling
3. Redis failure resilience (webhooks disabled, API still works)

---

## Implementation Sequence

### Sprint 1: Feature 1 + Infrastructure
1. Add `name` field to Carrier abstract class
2. Update all 33 carrier implementations
3. Update GraphQL schema + resolver
4. Test & verify
5. Create `packages/webhook` structure
6. Set up Prisma schema

### Sprint 2: Core Webhook Logic
1. Implement WebhookService
2. Implement WebhookRepository
3. Implement QueueManager
4. Implement TrackingMonitorJob
5. Write unit tests

### Sprint 3: Delivery & Error Handling
1. Implement WebhookDeliveryJob
2. Implement ExpirationCleanupJob
3. Add retry logic
4. Implement error logging
5. Write integration tests

### Sprint 4: GraphQL Integration
1. Add Mutation to schema
2. Implement mutation resolver
3. Update AppContext
4. Update server initialization
5. Test end-to-end

### Sprint 5: Docker & Deployment
1. Update Dockerfile
2. Create docker-compose.yml
3. Update .devcontainer
4. Test Docker build
5. Document deployment

---

## Key Files to Create/Modify

### Feature 1 (5 files)
1. `/packages/core/src/core/interfaces.ts` - Add name getter
2. 33 carrier files - Add name property
3. `/packages/api/src/schema/schema.graphql` - Add name field
4. `/packages/api/src/resolvers/carrier.ts` - Add name resolver
5. `/packages/api/src/resolvers/index.ts` - Export resolver

### Feature 2 (20+ new files)
1. `/packages/webhook/` - Entire new package
2. `/packages/api/src/resolvers/webhook.ts` - Mutation resolver
3. `/packages/api/src/AppContext.ts` - Add webhookService
4. `/packages/server/src/index.ts` - Initialize webhook service
5. `/Dockerfile` - Add webhook build steps
6. `/docker-compose.yml` - Redis + server orchestration
7. `/.devcontainer/docker-compose.yml` - Add Redis for dev

---

## Risks & Mitigations

### Risk 1: SQLite Performance at Scale
**Mitigation:** Prisma allows easy swap to PostgreSQL

### Risk 2: Redis Single Point of Failure
**Mitigation:** Feature is opt-in, graceful degradation

### Risk 3: Webhook Delivery Abuse
**Mitigation:** Rate limits, HTTPS validation, 30s timeout

### Risk 4: Carrier API Rate Limits
**Mitigation:** Conservative 5-minute polling interval

---

## Backward Compatibility

- Feature 1: Fully backward compatible (additive only)
- Feature 2: Opt-in via `ENABLE_WEBHOOKS=false` (default)
- Existing deployments work without Redis or SQLite
- GraphQL schema: Additive only (no breaking changes)

---

## Summary

**Feature 1 (Simple):** ~2-4 hours
- 38 files to modify (1 interface + 33 carriers + 4 GraphQL files)
- Zero infrastructure changes
- Fully backward compatible

**Feature 2 (Complex):** 4-5 weeks
- New `packages/webhook` package
- SQLite + Prisma + Bull + Redis
- Production-ready error handling
- Opt-in, doesn't affect existing deployments

**Total estimated effort:** 5 weeks
