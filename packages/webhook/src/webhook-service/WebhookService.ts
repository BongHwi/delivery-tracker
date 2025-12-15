import { CarrierRegistry } from "@delivery-tracker/core";
import { WebhookRepository } from "./WebhookRepository";
import { WebhookValidator, RegisterWebhookInput } from "./WebhookValidator";
import { QueueManager } from "../queue/QueueManager";
import { TrackingMonitorJob } from "../jobs/TrackingMonitorJob";
import { WebhookDeliveryJob } from "../jobs/WebhookDeliveryJob";
import { ExpirationCleanupJob } from "../jobs/ExpirationCleanupJob";
import { webhookLogger } from "../logger";
import { WebhookError } from "../errors";
import { TrackingCache, TrackingCacheConfig } from "../cache/TrackingCache";

export interface WebhookServiceConfig {
  databaseUrl: string;
  carrierRegistry: CarrierRegistry;
  queueManager: QueueManager;
  cache?: TrackingCacheConfig;
}

export class WebhookService {
  private repository: WebhookRepository;
  private carrierRegistry: CarrierRegistry;
  private queueManager: QueueManager;
  private cache: TrackingCache;
  private logger = webhookLogger.child({ component: "WebhookService" });

  constructor(config: WebhookServiceConfig) {
    this.repository = new WebhookRepository(config.databaseUrl);
    this.carrierRegistry = config.carrierRegistry;
    this.queueManager = config.queueManager;
    this.cache = new TrackingCache(config.cache);
  }

  async init(): Promise<void> {
    try {
      // Initialize repository (connect to database)
      await this.repository.init();

      // Set up job processors
      this.setupJobProcessors();

      // Start the expiration cleanup cron job
      await this.queueManager.addExpirationCleanupJob();

      this.logger.info("Webhook service initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize webhook service", { error });
      throw new WebhookError(
        `Webhook service initialization failed: ${(error as Error).message}`
      );
    }
  }

  async close(): Promise<void> {
    await this.repository.close();
    await this.queueManager.close();
    this.logger.info("Webhook service closed");
  }

  /**
   * Register a new webhook for tracking updates
   */
  async registerWebhook(input: unknown): Promise<string> {
    // Validate input
    const validatedInput = WebhookValidator.validateRegistrationInput(input);

    // Validate carrier ID
    const validCarrierIds = this.carrierRegistry.carriers.map(
      (c) => c.carrierId
    );
    WebhookValidator.validateCarrierId(
      validatedInput.carrierId,
      validCarrierIds
    );

    // Create webhook registration
    const webhook = await this.repository.createWebhook({
      carrierId: validatedInput.carrierId,
      trackingNumber: validatedInput.trackingNumber,
      callbackUrl: validatedInput.callbackUrl,
      expirationTime: validatedInput.expirationTime,
    });

    // Schedule repeating tracking monitor job
    await this.queueManager.addRepeatingTrackingMonitorJob({
      webhookRegistrationId: webhook.id,
      carrierId: webhook.carrierId,
      trackingNumber: webhook.trackingNumber,
    });

    this.logger.info("Webhook registered successfully", {
      webhookId: webhook.id,
      carrierId: webhook.carrierId,
      trackingNumber: webhook.trackingNumber,
    });

    return webhook.id;
  }

  /**
   * Deactivate a webhook
   */
  async deactivateWebhook(webhookId: string): Promise<void> {
    await this.repository.deactivateWebhook(webhookId);

    // Remove the tracking monitor job
    await this.queueManager.removeTrackingMonitorJob(webhookId);

    this.logger.info("Webhook deactivated", { webhookId });
  }

  /**
   * Get webhook details
   */
  async getWebhook(webhookId: string) {
    return await this.repository.findWebhookById(webhookId);
  }

  /**
   * Get delivery logs for a webhook
   */
  async getDeliveryLogs(webhookId: string, limit = 10) {
    return await this.repository.getDeliveryLogs(webhookId, limit);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [trackingMonitor, webhookDelivery] = await Promise.all([
      this.queueManager.getTrackingMonitorQueueStats(),
      this.queueManager.getWebhookDeliveryQueueStats(),
    ]);

    return {
      trackingMonitor,
      webhookDelivery,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear cache manually
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Set up job processors for all queues
   */
  private setupJobProcessors(): void {
    // Instantiate job processors
    const trackingMonitorJob = new TrackingMonitorJob(
      this.repository,
      this.carrierRegistry,
      this.queueManager,
      this.cache
    );

    const webhookDeliveryJob = new WebhookDeliveryJob(this.repository);

    const expirationCleanupJob = new ExpirationCleanupJob(
      this.repository,
      this.cache
    );

    // Register processors with queue manager
    this.queueManager.processTrackingMonitor((job) =>
      trackingMonitorJob.process(job)
    );

    this.queueManager.processWebhookDelivery((job) =>
      webhookDeliveryJob.process(job)
    );

    this.queueManager.processExpirationCleanup((job) =>
      expirationCleanupJob.process(job)
    );

    this.logger.info("Job processors registered successfully");
  }
}
