import { Job } from "bull";
import { fetch } from "undici";
import { WebhookRepository } from "../webhook-service/WebhookRepository";
import { WebhookDeliveryJobData } from "../queue/QueueManager";
import { webhookLogger } from "../logger";
import { WebhookDeliveryError } from "../errors";

const DELIVERY_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 4;

export class WebhookDeliveryJob {
  private repository: WebhookRepository;
  private logger = webhookLogger.child({ component: "WebhookDeliveryJob" });

  constructor(repository: WebhookRepository) {
    this.repository = repository;
  }

  /**
   * Process a webhook delivery job
   */
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const {
      webhookRegistrationId,
      callbackUrl,
      trackInfo,
      previousChecksum,
      currentChecksum,
    } = job.data;

    const attemptNumber = job.attemptsMade + 1;

    this.logger.debug("Processing webhook delivery", {
      webhookId: webhookRegistrationId,
      callbackUrl,
      attempt: attemptNumber,
    });

    // Increment delivery attempts
    await this.repository.incrementDeliveryAttempts(webhookRegistrationId);

    // Prepare request body
    const requestBody = JSON.stringify({
      webhookId: webhookRegistrationId,
      trackingData: JSON.parse(trackInfo),
      metadata: {
        previousChecksum,
        currentChecksum,
        deliveredAt: new Date().toISOString(),
      },
    });

    let statusCode: number | undefined;
    let responseBody: string | undefined;
    let success = false;
    let errorMessage: string | undefined;

    try {
      // Send HTTP POST request
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "delivery-tracker-webhook/1.0",
          "X-Webhook-Id": webhookRegistrationId,
          "X-Webhook-Attempt": attemptNumber.toString(),
        },
        body: requestBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => undefined);

      // Check if delivery was successful
      if (response.status >= 200 && response.status < 300) {
        success = true;
        this.logger.info("Webhook delivered successfully", {
          webhookId: webhookRegistrationId,
          statusCode,
          attempt: attemptNumber,
        });
      } else {
        errorMessage = `HTTP ${statusCode}: ${responseBody?.substring(0, 200)}`;
        this.logger.warn("Webhook delivery failed with non-2xx status", {
          webhookId: webhookRegistrationId,
          statusCode,
          attempt: attemptNumber,
        });

        // Determine if we should retry
        if (this.shouldRetry(statusCode, attemptNumber)) {
          throw new WebhookDeliveryError(
            errorMessage,
            statusCode,
            responseBody
          );
        }
      }
    } catch (error) {
      if (error instanceof WebhookDeliveryError) {
        // Re-throw delivery errors for retry
        errorMessage = error.message;
        throw error;
      }

      // Handle network errors, timeouts, etc.
      errorMessage = `Request failed: ${(error as Error).message}`;
      this.logger.warn("Webhook delivery failed with error", {
        webhookId: webhookRegistrationId,
        error: errorMessage,
        attempt: attemptNumber,
      });

      // Retry on network errors
      if (attemptNumber < MAX_RETRY_ATTEMPTS) {
        throw error;
      }
    } finally {
      // Log delivery attempt
      await this.repository.logDelivery({
        webhookRegistrationId,
        attemptNumber,
        statusCode,
        success,
        errorMessage,
        requestBody,
        responseBody: responseBody?.substring(0, 1000), // Limit size
      });

      // Update webhook registration
      if (success) {
        await this.repository.updateWebhook(webhookRegistrationId, {
          lastError: undefined,
        });
      } else if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
        // Exhausted all retries - deactivate webhook
        this.logger.error("Webhook delivery exhausted all retries", {
          webhookId: webhookRegistrationId,
          attempts: attemptNumber,
        });

        await this.repository.updateWebhook(webhookRegistrationId, {
          active: false,
          lastError: `Delivery failed after ${attemptNumber} attempts: ${errorMessage}`,
        });
      } else {
        // Store error for debugging but keep webhook active
        await this.repository.updateWebhook(webhookRegistrationId, {
          lastError: `Delivery attempt ${attemptNumber} failed: ${errorMessage}`,
        });
      }
    }
  }

  /**
   * Determine if a delivery should be retried based on status code and attempt number
   */
  private shouldRetry(statusCode: number, attemptNumber: number): boolean {
    if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
      return false;
    }

    // Retry on 5xx errors
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }

    // Retry once on 4xx errors (except 400, 401, 403, 404)
    if (statusCode >= 400 && statusCode < 500) {
      const nonRetryable4xx = [400, 401, 403, 404];
      if (nonRetryable4xx.includes(statusCode)) {
        return false;
      }
      return attemptNumber < 2; // Only retry once for 4xx
    }

    return false;
  }
}
