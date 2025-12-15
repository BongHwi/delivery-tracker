# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Delivery Tracker is a delivery and shipping tracking service that normalizes tracking data from 30+ carriers worldwide into a standardized format. The project is organized as a pnpm monorepo with TypeScript.

## Build and Development Commands

All builds and tests are performed using Docker:

```bash
# Build Docker image (builds entire project)
docker build -t delivery-tracker .

# Run server container
docker run -p 3000:3000 delivery-tracker

# Run tests in Docker
docker build --target build -t delivery-tracker-build .
docker run --rm delivery-tracker-build sh -c "cd /app/packages/core && pnpm test"

# For development, use GitHub Codespaces or local devcontainer
# See .devcontainer/docker-compose.yml
```

The Dockerfile uses a multi-stage build:
1. `prod-deps` stage - Installs production dependencies only
2. `build` stage - Installs all dependencies and runs `pnpm --filter @delivery-tracker/server build-with-deps`
3. Final stage - Combines production deps with built artifacts

## Package Structure

- **packages/core** - Carrier scraper implementations and core interfaces
- **packages/api** - GraphQL API layer that wraps core functionality
- **packages/cli** - Command-line interface tool
- **packages/server** - Self-hosted GraphQL HTTP server (Apollo Server)
- **packages/webhook** - Webhook infrastructure with Redis-backed job queue system (optional)

## Architecture: Carrier Scrapers

### Core Abstractions

All carriers extend the `Carrier` abstract class (packages/core/src/core/interfaces.ts):

```typescript
abstract class Carrier {
  protected upstreamFetcher: CarrierUpstreamFetcher;
  public abstract track(input: CarrierTrackInput): Promise<TrackInfo>;
  public abstract get carrierId(): string;
}
```

**Key interfaces:**
- `CarrierTrackInput` - Input containing `trackingNumber`
- `TrackInfo` - Normalized output with `events`, `sender`, `recipient`, `carrierSpecificData`
- `TrackEvent` - Individual tracking event with `status`, `time`, `location`, `contact`, `description`
- `TrackEventStatusCode` - Standardized enum: `InformationReceived`, `AtPickup`, `InTransit`, `OutForDelivery`, `AttemptFail`, `Delivered`, `AvailableForPickup`, `Exception`, `Unknown`

### Carrier Registry

**DefaultCarrierRegistry** (packages/core/src/carrier-registry/DefaultCarrierRegistry.ts):
- Singleton registry that manages all carrier instances
- Loads carriers on initialization
- Supports YAML configuration via `DELIVERY_TRACKER_CARRIER_REGISTRY_CONFIG_FILE` environment variable
- Can enable/disable carriers per configuration
- Creates a `CarrierUpstreamFetcher` for each carrier (handles HTTP requests with logging)

### Two-Class Pattern

Each carrier implementation follows this structure:

1. **Carrier class** - Extends `Carrier`, implements `track()` method, delegates to scraper
2. **Scraper class** - Contains actual scraping/API logic in a `track()` method

Example:
```typescript
class LotteGlobalLogistics extends Carrier {
  readonly carrierId = "kr.lotte";

  async track(input: CarrierTrackInput): Promise<TrackInfo> {
    return await new LotteGlobalLogisticsTrackScraper(
      this.upstreamFetcher,
      input.trackingNumber
    ).track();
  }
}

class LotteGlobalLogisticsTrackScraper {
  constructor(
    readonly upstreamFetcher: CarrierUpstreamFetcher,
    readonly trackingNumber: string
  ) {
    this.logger = carrierLogger.child({ trackingNumber });
  }

  async track(): Promise<TrackInfo> {
    // 1. Validate tracking number
    // 2. Fetch from upstream API/website
    // 3. Parse response (with Zod schemas)
    // 4. Map to standardized TrackInfo structure
    // 5. Return or throw appropriate error
  }
}
```

### Data Fetching Strategies

Carriers use different approaches:

1. **REST JSON APIs** - Most common (kr.lotte, us.fedex, de.dhl)
   - Use `upstreamFetcher.fetch()` and `response.json()`

2. **HTML Scraping** - For carriers without APIs (kr.coupangls, jp.yamato)
   - Use `jsdom` for DOM manipulation or `cheerio` for lightweight parsing

3. **Form-based POST** - Submit forms and parse responses (jp.yamato, us.ups)
   - Use `URLSearchParams` for form encoding

4. **Multi-step APIs** - Chain multiple API calls (kr.homepick)
   - First call retrieves ID, second call retrieves tracking data

### Response Validation with Zod

Each carrier that uses JSON APIs defines Zod schemas in `*APISchemas.ts` files:

```typescript
const ResponseSchema = z.object({
  errorCd: z.string(),
  tracking: z.array(TrackingItemSchema),
});

// In scraper
const json = await response.json();
const safeParseResult = await ResponseSchema.strict().safeParseAsync(json);
if (!safeParseResult.success) {
  this.logger.warn("parse failed", { error: safeParseResult.error });
}
```

This provides runtime type validation and TypeScript type inference.

### Key Parsing Methods

Scrapers typically implement:

1. **`parseStatusCode(rawStatus)`** - Maps carrier codes to `TrackEventStatusCode` enum
2. **`parseTime(timeString)`** - Parse carrier's date format to Luxon `DateTime` (timezone-aware)
3. **`parseLocation(locationData)`** - Extract location with ISO 3166-1 alpha-2 country code
4. **`parseEvent(rawEvent)`** - Combines above into `TrackEvent`

### Error Handling

Use these error classes from packages/core/src/core/errors.ts:

- `BadRequestError` - Invalid tracking number format
- `NotFoundError` - Tracking number not found
- `InternalError` - API failures, parsing errors

Never throw unhandled exceptions.

### Logging

All carriers follow this pattern:

```typescript
const carrierLogger = rootLogger.child({ carrierId: "kr.lotte" });
this.logger = carrierLogger.child({ trackingNumber });

// Usage
this.logger.debug("response", { json: responseJson });
this.logger.warn("parse error", { inputTime: time });
```

## Adding a New Carrier

1. Create directory: `packages/core/src/carriers/{country}.{carrier}/`
2. Create `index.ts` with Carrier and Scraper classes
3. Create `*APISchemas.ts` if using JSON APIs
4. Register in `DefaultCarrierRegistry.ts`:
   ```typescript
   await this.register(new NewCarrier());
   ```
5. Use git commit message format: `{country}.{carrier}: {description}`

Recent examples:
- `kr.coupangls: switch from JSON to HTML parsing` (2131028)
- `kr.lotte: Infer "Delivered" event from recipient registration event` (35c77dd)

### Naming Conventions

- Carrier ID: `{country}.{name}` (e.g., `kr.lotte`, `us.fedex`, `jp.yamato`)
- Class name: PascalCase without country prefix (e.g., `Fedex`, `DHL`)
- Scraper class: `{Name}TrackScraper`
- Schemas file: `{Name}APISchemas.ts`

## GraphQL API (packages/api)

The API layer exposes carrier tracking through GraphQL:

```bash
# Build API (generates TypeScript types from GraphQL schema)
cd packages/api && pnpm build
```

Build process:
1. Runs `graphql-codegen` to generate types from schema
2. Compiles TypeScript
3. Copies `schema.graphql` to dist

## Key Dependencies

- **luxon** - DateTime parsing with timezone support (prefer over native Date)
- **zod** - Runtime type validation
- **jsdom** / **cheerio** - HTML parsing
- **winston** - Structured logging
- **tough-cookie** - Cookie handling
- **libphonenumber-js** - Phone number parsing
- **yaml** - Configuration files
- **iconv-lite** - Character encoding conversion

## Development Environment

The project supports GitHub Codespaces (see README.md). Use the "Run and Debug" section in VSCode to launch `@delivery-tracker/server`.

## Webhook Infrastructure (packages/webhook)

The webhook package provides an optional feature for tracking status change notifications via HTTP callbacks.

### Architecture

**Core Components:**
- `WebhookService` - Main orchestrator for webhook lifecycle
- `WebhookRepository` - Prisma-based SQLite database operations
- `QueueManager` - Bull queue wrapper for Redis job processing
- `TrackingCache` - In-memory cache for tracking results (reduces carrier API calls)
- `TrackingMonitorJob` - Periodic tracking checks (1-minute intervals)
- `WebhookDeliveryJob` - HTTP POST delivery to callback URLs
- `ExpirationCleanupJob` - Cleanup expired webhooks and cache entries

### Database Schema

```prisma
model Webhook {
  id              String   @id @default(uuid())
  carrierId       String
  trackingNumber  String
  callbackUrl     String
  lastStatusCode  String?
  expirationTime  DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Job Queue System

**TrackingMonitorJob** (runs every 60 seconds):
1. Fetches active webhooks from database
2. Checks cache for tracking data (5-minute TTL by default)
3. If cache miss, calls carrier tracking API and stores in cache
4. Compares current status checksum with last known checksum
5. If changed, enqueues WebhookDeliveryJob
6. Updates lastChecksum in database

**WebhookDeliveryJob**:
- HTTP POST to callback URL with JSON payload
- Custom headers: `x-webhook-id`, `x-webhook-attempt`
- Retry logic: 3 attempts with exponential backoff
- Timeout: 30 seconds per attempt

**ExpirationCleanupJob** (runs every 5 minutes):
- Deletes webhooks past their expirationTime
- Cleans up expired cache entries

### Caching System

**TrackingCache** (packages/webhook/src/cache/TrackingCache.ts):
- In-memory LRU cache for tracking results
- Default TTL: 5 minutes (configurable)
- Default max size: 1000 entries (configurable)
- Automatically evicts oldest entries when full
- Reduces redundant API calls to carrier services

**Benefits:**
- Multiple webhooks tracking the same package share cached data
- Reduces load on carrier APIs (prevents rate limiting/blocking)
- Faster webhook processing (cache hits skip API calls)

**Configuration:**
```typescript
const webhookService = new WebhookService({
  databaseUrl: "file:./webhook.db",
  carrierRegistry: registry,
  queueManager: queueMgr,
  cache: {
    ttl: 5 * 60 * 1000,  // 5 minutes
    maxSize: 1000         // max entries
  }
});
```

**Cache Statistics:**
```typescript
const stats = webhookService.getCacheStats();
// Returns: { totalEntries, validEntries, expiredEntries, maxSize, ttl }
```

### GraphQL API

```graphql
mutation RegisterTrackWebhook($input: RegisterTrackWebhookInput!) {
  registerTrackWebhook(input: $input)
}

input RegisterTrackWebhookInput {
  carrierId: ID!
  trackingNumber: String!
  callbackUrl: String!
  expirationTime: DateTime!
}
```

Returns a webhook ID (UUID).

### Webhook Payload

```json
{
  "webhookId": "uuid-here",
  "trackingData": {
    "lastEvent": {
      "time": "2025-01-15T10:30:00+09:00",
      "status": { "code": "delivered", "name": null },
      "description": "Package delivered"
    },
    "events": { /* ... */ },
    "sender": { /* ... */ },
    "recipient": { /* ... */ }
  },
  "metadata": {
    "carrierId": "kr.cjlogistics",
    "trackingNumber": "1234567890",
    "triggeredAt": "2025-01-15T10:31:00Z"
  }
}
```

### Environment Configuration

```bash
# Enable webhook feature
ENABLE_WEBHOOKS=true

# SQLite database path
WEBHOOK_DATABASE_URL=file:./webhook.db

# Redis configuration (required if webhooks enabled)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional
REDIS_DB=0
```

### Deployment with Webhooks

**Using Docker Compose (Recommended):**
```bash
# Create .env file
cat > .env << EOF
ENABLE_WEBHOOKS=true
PORT=4000
REDIS_HOST=redis
REDIS_PORT=6379
WEBHOOK_DATABASE_URL=file:/data/webhook.db
EOF

# Start services
docker compose up -d
```

**Using Docker:**
```bash
# Start Redis
docker network create delivery-tracker-net
docker run -d --name redis --network delivery-tracker-net redis:7-alpine

# Start server with webhooks
docker run -d --name server --network delivery-tracker-net -p 4000:4000 \
  -e ENABLE_WEBHOOKS=true \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e WEBHOOK_DATABASE_URL=file:/data/webhook.db \
  -v webhook-data:/data \
  delivery-tracker
```

### Database Migrations

The `docker-entrypoint.sh` script automatically runs Prisma migrations at container startup:

```bash
#!/bin/sh
if [ "$ENABLE_WEBHOOKS" = "true" ]; then
  cd /app/packages/webhook
  npx prisma@5.22.0 db push --skip-generate
  cd /app/packages/server
fi
exec "$@"
```

For development:
```bash
cd packages/webhook
pnpm prisma db push
pnpm prisma generate
```

## Test Carrier (dev.track.dummy)

A dummy carrier is available for testing without requiring real tracking numbers.

**Carrier ID:** `dev.track.dummy`

**Valid Tracking Numbers:**
- `DELIVERED` - Returns a package that was delivered
- `IN_TRANSIT` - Returns a package currently in transit
- `OUT_FOR_DELIVERY` - Returns a package out for delivery
- `EXCEPTION` - Returns a package with an exception
- `NOT_FOUND` - Throws NotFoundError

**Example Usage:**
```graphql
query {
  track(carrierId: "dev.track.dummy", trackingNumber: "IN_TRANSIT") {
    lastEvent {
      status { code }
      description
    }
  }
}
```

**Implementation Location:** packages/core/src/carriers/dev.track.dummy/index.ts

The dummy carrier follows the same two-class pattern as real carriers and includes realistic tracking events with proper timestamps, locations, and status codes.

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Clone repository
git clone https://github.com/shlee322/delivery-tracker.git
cd delivery-tracker

# Configure environment (optional)
cp .env.example .env
# Edit .env to customize PORT, ENABLE_WEBHOOKS, etc.

# Start services
docker compose up -d

# View logs
docker compose logs -f server

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v

# Rebuild after code changes
docker compose up -d --build
```

### Using Docker

```bash
# Build image
docker build -t delivery-tracker .

# Run without webhooks
docker run -p 4000:4000 delivery-tracker

# Run with webhooks (requires Redis)
docker network create delivery-tracker-net
docker run -d --name redis --network delivery-tracker-net redis:7-alpine
docker run -d --name server --network delivery-tracker-net -p 4000:4000 \
  -e ENABLE_WEBHOOKS=true \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e WEBHOOK_DATABASE_URL=file:/data/webhook.db \
  delivery-tracker
```

### Docker Build Details

The multi-stage Dockerfile includes:

1. **Base stage** - Installs pnpm and OpenSSL (required for Prisma)
   ```dockerfile
   RUN apk add --no-cache openssl
   ```

2. **Build stage** - Compiles TypeScript and generates Prisma client
   ```dockerfile
   RUN pnpm --filter @delivery-tracker/server build-with-deps
   ```

3. **Final stage** - Production image with minimal dependencies
   - Copies package.json files first to establish workspace symlinks
   - Runs `pnpm install --prod --frozen-lockfile`
   - Copies built artifacts from build stage
   - Uses entrypoint script for runtime migrations

### Common Docker Issues

**Issue: Module resolution errors**
- Cause: Workspace symlinks not created properly
- Fix: Ensure all package.json files copied before `pnpm install --prod`

**Issue: Prisma version mismatch**
- Cause: npm installing latest Prisma instead of project version
- Fix: Pin version explicitly: `npx prisma@5.22.0 generate`

**Issue: OpenSSL missing**
- Cause: Alpine Linux doesn't include OpenSSL by default
- Fix: Add `RUN apk add --no-cache openssl` to Dockerfile

**Issue: Database not initialized**
- Cause: SQLite database doesn't exist at runtime
- Fix: Entrypoint script runs `prisma db push` on startup

## Important Notes

- All tracking events must be ordered chronologically (oldest first)
- DateTime objects must include timezone information (never naive)
- Use `Map` for `carrierSpecificData` (not plain objects)
- Country codes must be ISO 3166-1 alpha-2 (e.g., "KR", "JP", "US")
- Validate tracking number format at the start of `track()` when possible
- Event status codes should be as specific as possible (avoid `Unknown` when you can infer the actual status)
- Webhook feature requires Redis and SQLite, controlled by `ENABLE_WEBHOOKS` environment variable
- Use `dev.track.dummy` carrier for testing webhook flows without real carrier APIs
- All required interface fields must be present (status.name, status.carrierSpecificData, location.postalCode, contact, etc.)
