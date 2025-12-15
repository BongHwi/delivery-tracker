import { Job } from "bull";
import { WebhookRepository } from "../webhook-service/WebhookRepository";
import { webhookLogger } from "../logger";

export class ExpirationCleanupJob {
  private repository: WebhookRepository;
  private logger = webhookLogger.child({ component: "ExpirationCleanupJob" });

  constructor(repository: WebhookRepository) {
    this.repository = repository;
  }

  /**
   * Process expiration cleanup job
   * Runs every hour via cron
   */
  async process(job: Job<void>): Promise<void> {
    this.logger.debug("Processing expiration cleanup job");

    try {
      const deactivatedCount = await this.repository.deactivateExpiredWebhooks();

      if (deactivatedCount > 0) {
        this.logger.info("Expired webhooks cleaned up", {
          count: deactivatedCount,
        });
      } else {
        this.logger.debug("No expired webhooks found");
      }
    } catch (error) {
      this.logger.error("Expiration cleanup job failed", { error });
      throw error; // Re-throw for Bull retry logic
    }
  }
}
