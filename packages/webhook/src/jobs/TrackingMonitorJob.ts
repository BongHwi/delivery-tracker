import { Job } from "bull";
import { createHash } from "crypto";
import { CarrierRegistry, TrackInfo } from "@delivery-tracker/core";
import { WebhookRepository } from "../webhook-service/WebhookRepository";
import { QueueManager, TrackingMonitorJobData } from "../queue/QueueManager";
import { webhookLogger } from "../logger";
import { TrackingCache } from "../cache/TrackingCache";

export class TrackingMonitorJob {
  private repository: WebhookRepository;
  private carrierRegistry: CarrierRegistry;
  private queueManager: QueueManager;
  private cache: TrackingCache;
  private logger = webhookLogger.child({ component: "TrackingMonitorJob" });

  constructor(
    repository: WebhookRepository,
    carrierRegistry: CarrierRegistry,
    queueManager: QueueManager,
    cache: TrackingCache
  ) {
    this.repository = repository;
    this.carrierRegistry = carrierRegistry;
    this.queueManager = queueManager;
    this.cache = cache;
  }

  /**
   * Process a tracking monitor job
   */
  async process(job: Job<TrackingMonitorJobData>): Promise<void> {
    const { webhookRegistrationId, carrierId, trackingNumber } = job.data;

    this.logger.debug("Processing tracking monitor job", {
      webhookId: webhookRegistrationId,
      carrierId,
      trackingNumber,
    });

    try {
      // Fetch webhook registration
      const webhook = await this.repository.findWebhookById(
        webhookRegistrationId
      );

      if (!webhook || !webhook.active) {
        this.logger.info("Webhook not found or inactive, removing job", {
          webhookId: webhookRegistrationId,
        });
        await this.queueManager.removeTrackingMonitorJob(webhookRegistrationId);
        return;
      }

      // Check if webhook has expired
      if (new Date() > webhook.expirationTime) {
        this.logger.info("Webhook expired during processing", {
          webhookId: webhookRegistrationId,
        });
        await this.repository.deactivateWebhook(webhookRegistrationId);
        await this.queueManager.removeTrackingMonitorJob(webhookRegistrationId);
        return;
      }

      // Get carrier and track package
      const carrier = this.carrierRegistry.get(carrierId);
      if (!carrier) {
        this.logger.error("Carrier not found", { carrierId });
        await this.repository.updateWebhook(webhookRegistrationId, {
          lastError: `Carrier not found: ${carrierId}`,
          lastCheckedAt: new Date(),
        });
        return;
      }

      // Try to get from cache first
      let trackInfo: TrackInfo | null = this.cache.get(carrierId, trackingNumber);

      if (trackInfo) {
        this.logger.debug("Using cached tracking data", {
          webhookId: webhookRegistrationId,
          carrierId,
          trackingNumber,
        });
      } else {
        // Cache miss - fetch from carrier API
        try {
          trackInfo = await carrier.track({ trackingNumber });

          // Store in cache for future requests
          this.cache.set(carrierId, trackingNumber, trackInfo);

          this.logger.debug("Fetched fresh tracking data", {
            webhookId: webhookRegistrationId,
            carrierId,
            trackingNumber,
          });
        } catch (error) {
          this.logger.warn("Tracking failed (carrier API error)", {
            webhookId: webhookRegistrationId,
            carrierId,
            trackingNumber,
            error: (error as Error).message,
          });

          // Update last checked time but don't treat as webhook failure
          await this.repository.updateWebhook(webhookRegistrationId, {
            lastCheckedAt: new Date(),
            lastError: `Tracking API error: ${(error as Error).message}`,
          });
          return;
        }
      }

      // Compute checksum of tracking events
      const currentChecksum = this.computeChecksum(trackInfo);

      // Check if there's a change
      if (webhook.lastChecksum && webhook.lastChecksum === currentChecksum) {
        this.logger.debug("No changes detected", {
          webhookId: webhookRegistrationId,
          checksum: currentChecksum,
        });

        // Update last checked time
        await this.repository.updateWebhook(webhookRegistrationId, {
          lastCheckedAt: new Date(),
        });
        return;
      }

      // Changes detected - enqueue webhook delivery job
      this.logger.info("Changes detected, enqueuing delivery", {
        webhookId: webhookRegistrationId,
        previousChecksum: webhook.lastChecksum,
        currentChecksum,
      });

      await this.queueManager.addWebhookDeliveryJob({
        webhookRegistrationId,
        callbackUrl: webhook.callbackUrl,
        trackInfo: JSON.stringify(trackInfo),
        previousChecksum: webhook.lastChecksum ?? undefined,
        currentChecksum,
      });

      // Update webhook with new checksum and last checked time
      await this.repository.updateWebhook(webhookRegistrationId, {
        lastChecksum: currentChecksum,
        lastCheckedAt: new Date(),
        lastError: undefined, // Clear any previous errors
      });
    } catch (error) {
      this.logger.error("Tracking monitor job failed", {
        webhookId: webhookRegistrationId,
        error,
      });

      // Update webhook with error
      await this.repository.updateWebhook(webhookRegistrationId, {
        lastCheckedAt: new Date(),
        lastError: `Job processing error: ${(error as Error).message}`,
      });

      throw error; // Re-throw for Bull retry logic
    }
  }

  /**
   * Compute SHA-256 checksum of tracking events
   */
  private computeChecksum(trackInfo: TrackInfo): string {
    // Only include events in checksum (sender/recipient rarely change)
    const eventsData = JSON.stringify(trackInfo.events, (key, value) => {
      // Sort object keys for consistent hashing
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {} as any);
      }
      return value;
    });

    return createHash("sha256").update(eventsData).digest("hex");
  }
}
