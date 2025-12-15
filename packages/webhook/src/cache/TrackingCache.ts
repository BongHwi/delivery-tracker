import { TrackInfo } from "@delivery-tracker/core";
import { webhookLogger } from "../logger";

export interface TrackingCacheConfig {
  /**
   * Cache TTL in milliseconds (default: 5 minutes)
   */
  ttl?: number;

  /**
   * Maximum number of cache entries (default: 1000)
   */
  maxSize?: number;
}

interface CacheEntry {
  data: TrackInfo;
  timestamp: number;
}

/**
 * In-memory cache for tracking results
 * Reduces redundant API calls to carrier services
 */
export class TrackingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly maxSize: number;
  private logger = webhookLogger.child({ component: "TrackingCache" });

  constructor(config: TrackingCacheConfig = {}) {
    this.ttl = config.ttl ?? 5 * 60 * 1000; // Default: 5 minutes
    this.maxSize = config.maxSize ?? 1000; // Default: 1000 entries
  }

  /**
   * Get cached tracking data if available and not expired
   */
  get(carrierId: string, trackingNumber: string): TrackInfo | null {
    const key = this.buildKey(carrierId, trackingNumber);
    const entry = this.cache.get(key);

    if (!entry) {
      this.logger.debug("Cache miss", { carrierId, trackingNumber });
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.logger.debug("Cache expired", {
        carrierId,
        trackingNumber,
        age,
        ttl: this.ttl,
      });
      this.cache.delete(key);
      return null;
    }

    this.logger.debug("Cache hit", {
      carrierId,
      trackingNumber,
      age,
    });

    return entry.data;
  }

  /**
   * Store tracking data in cache
   */
  set(carrierId: string, trackingNumber: string, data: TrackInfo): void {
    // Enforce max size limit using LRU eviction
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const key = this.buildKey(carrierId, trackingNumber);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    this.logger.debug("Cache updated", {
      carrierId,
      trackingNumber,
      cacheSize: this.cache.size,
    });
  }

  /**
   * Invalidate cached entry
   */
  invalidate(carrierId: string, trackingNumber: string): void {
    const key = this.buildKey(carrierId, trackingNumber);
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.logger.debug("Cache invalidated", { carrierId, trackingNumber });
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info("Cache cleared", { clearedEntries: size });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let expiredCount = 0;
    let validCount = 0;

    for (const [, entry] of this.cache) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries: validCount,
      expiredEntries: expiredCount,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info("Cleaned up expired cache entries", {
        cleanedCount,
        remainingEntries: this.cache.size,
      });
    }
  }

  /**
   * Build cache key from carrier ID and tracking number
   */
  private buildKey(carrierId: string, trackingNumber: string): string {
    return `${carrierId}:${trackingNumber}`;
  }

  /**
   * Evict oldest entry when cache is full
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug("Evicted oldest cache entry", {
        key: oldestKey,
        age: Date.now() - oldestTimestamp,
      });
    }
  }
}
