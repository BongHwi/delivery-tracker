import { Job } from "bull";
import { WebhookRepository } from "../webhook-service/WebhookRepository";
import { webhookLogger } from "../logger";
import { TrackingCache } from "../cache/TrackingCache";

export class ExpirationCleanupJob {
  private repository: WebhookRepository;
  private cache: TrackingCache;
  private logger = webhookLogger.child({ component: "ExpirationCleanupJob" });

  constructor(repository: WebhookRepository, cache: TrackingCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /**
   * Process expiration cleanup job
   * Runs every hour via cron
   * Also cleans up expired cache entries
   */
  async process(job: Job<void>): Promise<void> {
    this.logger.debug("Processing expiration cleanup job");

    try {
      // Clean up expired webhooks
      const deactivatedCount = await this.repository.deactivateExpiredWebhooks();

      if (deactivatedCount > 0) {
        this.logger.info("Expired webhooks cleaned up", {
          count: deactivatedCount,
        });
      } else {
        this.logger.debug("No expired webhooks found");
      }

      // Clean up expired cache entries
      this.cache.cleanup();
    } catch (error) {
      this.logger.error("Expiration cleanup job failed", { error });
      throw error; // Re-throw for Bull retry logic
    }
  }
}
