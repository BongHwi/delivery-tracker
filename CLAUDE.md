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

## Important Notes

- All tracking events must be ordered chronologically (oldest first)
- DateTime objects must include timezone information (never naive)
- Use `Map` for `carrierSpecificData` (not plain objects)
- Country codes must be ISO 3166-1 alpha-2 (e.g., "KR", "JP", "US")
- Validate tracking number format at the start of `track()` when possible
- Event status codes should be as specific as possible (avoid `Unknown` when you can infer the actual status)
