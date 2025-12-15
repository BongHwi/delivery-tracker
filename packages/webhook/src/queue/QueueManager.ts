import Bull, { Queue, Job, JobOptions } from "bull";
import Redis from "ioredis";
import { webhookLogger } from "../logger";

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export interface QueueManagerConfig {
  redis: RedisConfig;
  /**
   * Tracking monitor interval in milliseconds (default: 1 hour)
   */
  trackingMonitorInterval?: number;
}

export interface TrackingMonitorJobData {
  webhookRegistrationId: string;
  carrierId: string;
  trackingNumber: string;
}

export interface WebhookDeliveryJobData {
  webhookRegistrationId: string;
  callbackUrl: string;
  trackInfo: string; // JSON stringified TrackInfo
  previousChecksum?: string;
  currentChecksum: string;
}

export type QueueJobProcessor<T> = (job: Job<T>) => Promise<void>;

export class QueueManager {
  private redisConfig?: RedisConfig;
  private trackingMonitorInterval: number;
  private trackingMonitorQueue?: Queue<TrackingMonitorJobData>;
  private webhookDeliveryQueue?: Queue<WebhookDeliveryJobData>;
  private expirationCleanupQueue?: Queue<void>;
  private logger = webhookLogger.child({ component: "QueueManager" });

  constructor() {
    this.trackingMonitorInterval = 60 * 60 * 1000; // Default: 1 hour
  }

  async init(config: RedisConfig | QueueManagerConfig): Promise<void> {
    // Support both old RedisConfig and new QueueManagerConfig
    if ('redis' in config) {
      this.redisConfig = config.redis;
      this.trackingMonitorInterval = config.trackingMonitorInterval ?? 60 * 60 * 1000;
    } else {
      this.redisConfig = config;
      this.trackingMonitorInterval = 60 * 60 * 1000;
    }

    // Create Bull queues
    this.trackingMonitorQueue = new Bull<TrackingMonitorJobData>(
      "tracking-monitor",
      {
        redis: this.redisConfig,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 60000, // 1 minute
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }
    );

    this.webhookDeliveryQueue = new Bull<WebhookDeliveryJobData>(
      "webhook-delivery",
      {
        redis: this.redisConfig,
        defaultJobOptions: {
          attempts: 4,
          backoff: {
            type: "exponential",
            delay: 60000, // Start with 1 minute: 1min, 2min, 4min, 8min
          },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }
    );

    this.expirationCleanupQueue = new Bull<void>("expiration-cleanup", {
      redis: this.redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 300000, // 5 minutes
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    });

    // Set up error handlers
    this.setupErrorHandlers();

    this.logger.info("Queue manager initialized", {
      host: config.host,
      port: config.port,
    });
  }

  private setupErrorHandlers(): void {
    const queues = [
      { name: "tracking-monitor", queue: this.trackingMonitorQueue },
      { name: "webhook-delivery", queue: this.webhookDeliveryQueue },
      { name: "expiration-cleanup", queue: this.expirationCleanupQueue },
    ];

    for (const { name, queue } of queues) {
      if (!queue) continue;

      queue.on("error", (error) => {
        this.logger.error(`Queue error in ${name}`, { error });
      });

      queue.on("failed", (job, error) => {
        this.logger.warn(`Job failed in ${name}`, {
          jobId: job.id,
          attemptsMade: job.attemptsMade,
          error: error.message,
        });
      });

      queue.on("stalled", (job) => {
        this.logger.warn(`Job stalled in ${name}`, { jobId: job.id });
      });
    }
  }

  async close(): Promise<void> {
    const queues = [
      this.trackingMonitorQueue,
      this.webhookDeliveryQueue,
      this.expirationCleanupQueue,
    ];

    for (const queue of queues) {
      if (queue) {
        await queue.close();
      }
    }

    this.logger.info("Queue manager closed");
  }

  // Tracking Monitor Queue Methods
  async addTrackingMonitorJob(
    data: TrackingMonitorJobData,
    options?: JobOptions
  ): Promise<Job<TrackingMonitorJobData>> {
    if (!this.trackingMonitorQueue) {
      throw new Error("Queue manager not initialized");
    }

    return await this.trackingMonitorQueue.add(data, {
      ...options,
      jobId: `${data.webhookRegistrationId}`, // Ensure only one job per webhook
      repeat: options?.repeat,
    });
  }

  async addRepeatingTrackingMonitorJob(
    data: TrackingMonitorJobData
  ): Promise<Job<TrackingMonitorJobData>> {
    return await this.addTrackingMonitorJob(data, {
      repeat: {
        every: this.trackingMonitorInterval,
      },
    });
  }

  async removeTrackingMonitorJob(webhookRegistrationId: string): Promise<void> {
    if (!this.trackingMonitorQueue) {
      throw new Error("Queue manager not initialized");
    }

    const job = await this.trackingMonitorQueue.getJob(webhookRegistrationId);
    if (job) {
      await job.remove();
      this.logger.debug("Tracking monitor job removed", {
        webhookRegistrationId,
      });
    }
  }

  processTrackingMonitor(
    processor: QueueJobProcessor<TrackingMonitorJobData>
  ): void {
    if (!this.trackingMonitorQueue) {
      throw new Error("Queue manager not initialized");
    }

    this.trackingMonitorQueue.process(async (job) => {
      this.logger.debug("Processing tracking monitor job", {
        webhookId: job.data.webhookRegistrationId,
      });
      await processor(job);
    });
  }

  // Webhook Delivery Queue Methods
  async addWebhookDeliveryJob(
    data: WebhookDeliveryJobData,
    options?: JobOptions
  ): Promise<Job<WebhookDeliveryJobData>> {
    if (!this.webhookDeliveryQueue) {
      throw new Error("Queue manager not initialized");
    }

    return await this.webhookDeliveryQueue.add(data, options);
  }

  processWebhookDelivery(
    processor: QueueJobProcessor<WebhookDeliveryJobData>
  ): void {
    if (!this.webhookDeliveryQueue) {
      throw new Error("Queue manager not initialized");
    }

    this.webhookDeliveryQueue.process(async (job) => {
      this.logger.debug("Processing webhook delivery job", {
        webhookId: job.data.webhookRegistrationId,
        attempt: job.attemptsMade + 1,
      });
      await processor(job);
    });
  }

  // Expiration Cleanup Queue Methods
  async addExpirationCleanupJob(): Promise<Job<void>> {
    if (!this.expirationCleanupQueue) {
      throw new Error("Queue manager not initialized");
    }

    return await this.expirationCleanupQueue.add(
      "cleanup",
      undefined as any,
      {
        repeat: {
          cron: "0 * * * *", // Every hour
        },
        jobId: "expiration-cleanup",
      }
    );
  }

  processExpirationCleanup(processor: QueueJobProcessor<void>): void {
    if (!this.expirationCleanupQueue) {
      throw new Error("Queue manager not initialized");
    }

    this.expirationCleanupQueue.process(async (job) => {
      this.logger.debug("Processing expiration cleanup job");
      await processor(job);
    });
  }

  // Utility methods
  async getTrackingMonitorQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.trackingMonitorQueue) {
      throw new Error("Queue manager not initialized");
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.trackingMonitorQueue.getWaitingCount(),
      this.trackingMonitorQueue.getActiveCount(),
      this.trackingMonitorQueue.getCompletedCount(),
      this.trackingMonitorQueue.getFailedCount(),
      this.trackingMonitorQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  async getWebhookDeliveryQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.webhookDeliveryQueue) {
      throw new Error("Queue manager not initialized");
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.webhookDeliveryQueue.getWaitingCount(),
      this.webhookDeliveryQueue.getActiveCount(),
      this.webhookDeliveryQueue.getCompletedCount(),
      this.webhookDeliveryQueue.getFailedCount(),
      this.webhookDeliveryQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
