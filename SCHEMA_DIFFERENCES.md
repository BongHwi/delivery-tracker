# GraphQL Schema Differences

This document compares the published schema at https://tracker.delivery/docs/api-schema with the current codebase schema.

**Comparison Date:** 2025-12-15

## Summary

The published web API includes webhook functionality and additional carrier metadata that are not present in the current codebase schema.

## Differences

### 1. Carrier Type - Missing `name` Field

**Published Schema:**
```graphql
type Carrier {
  id: ID!
  name: String!  # ← Missing in codebase
}
```

**Current Codebase Schema (packages/api/src/schema/schema.graphql:69-71):**
```graphql
type Carrier {
  id: ID!
}
```

**Impact:** The published API exposes human-readable carrier names (e.g., "FedEx", "DHL"), while the current codebase only provides carrier IDs (e.g., "us.fedex", "de.dhl").

---

### 2. Missing Webhook Mutation

**Published Schema includes:**
```graphql
type Mutation {
  registerTrackWebhook(input: RegisterTrackWebhookInput!): Boolean
}
```

**Current Codebase:** No Mutation type defined at all.

**Description:** The webhook mutation "Register or update a Track Webhook. When there is a change in the TrackInfo, an HTTP Request is sent to the callbackUrl."

---

### 3. Missing RegisterTrackWebhookInput Type

**Published Schema includes:**
```graphql
input RegisterTrackWebhookInput {
  carrierId: ID!
  trackingNumber: String!
  callbackUrl: String!
  expirationTime: DateTime!
}
```

**Current Codebase:** This input type doesn't exist.

**Field Descriptions:**
- `carrierId`: The unique identifier of the carrier
- `trackingNumber`: The tracking number of the shipment
- `callbackUrl`: The URL to be called when there is a change in the TrackInfo
- `expirationTime`: The expiration time of the webhook (automatically deletes after this time)

---

## Schema Parity Checklist

### Types Present in Both
- ✅ Query type (with track, carriers, carrier queries)
- ✅ Carrier type (partial - missing name field)
- ✅ CarrierConnection type
- ✅ CarrierEdge type
- ✅ TrackInfo type
- ✅ TrackEvent type
- ✅ TrackEventConnection type
- ✅ TrackEventEdge type
- ✅ TrackEventStatus type
- ✅ Location type
- ✅ ContactInfo type
- ✅ PageInfo type

### Enums Present in Both
- ✅ TrackEventStatusCode enum
- ✅ ErrorCode enum

### Scalars Present in Both
- ✅ DateTime scalar

### Missing from Codebase
- ❌ Mutation type
- ❌ registerTrackWebhook mutation
- ❌ RegisterTrackWebhookInput input type
- ❌ Carrier.name field

---

## Notes

1. **Webhook Infrastructure**: The published API has webhook functionality that requires backend infrastructure for:
   - Storing webhook registrations
   - Monitoring TrackInfo changes
   - Making HTTP callbacks
   - Handling webhook expiration

2. **Carrier Names**: Adding the `name` field would require:
   - Each carrier implementation to provide a human-readable name
   - Updates to the Carrier interface/abstract class
   - Resolver implementation in the API layer

3. **API Versioning**: The differences suggest the published API (tracker.delivery) is a hosted service with additional features beyond the open-source self-hosted version in this repository.
