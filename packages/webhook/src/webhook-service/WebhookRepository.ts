import { PrismaClient, WebhookRegistration, WebhookDeliveryLog } from "@prisma/client";
import { DateTime } from "luxon";
import { webhookLogger } from "../logger";
import { WebhookNotFoundError } from "../errors";

export interface CreateWebhookInput {
  carrierId: string;
  trackingNumber: string;
  callbackUrl: string;
  expirationTime: Date;
}

export interface UpdateWebhookInput {
  lastChecksum?: string;
  lastCheckedAt?: Date;
  deliveryAttempts?: number;
  lastDeliveryAt?: Date;
  lastError?: string;
  active?: boolean;
}

export interface LogDeliveryInput {
  webhookRegistrationId: string;
  attemptNumber: number;
  statusCode?: number;
  success: boolean;
  errorMessage?: string;
  requestBody: string;
  responseBody?: string;
}

export class WebhookRepository {
  private prisma: PrismaClient;
  private logger = webhookLogger.child({ component: "WebhookRepository" });

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }

  async init(): Promise<void> {
    await this.prisma.$connect();
    this.logger.info("Database connected");
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.info("Database disconnected");
  }

  async createWebhook(input: CreateWebhookInput): Promise<WebhookRegistration> {
    const webhook = await this.prisma.webhookRegistration.create({
      data: input,
    });

    this.logger.info("Webhook created", {
      webhookId: webhook.id,
      carrierId: webhook.carrierId,
      trackingNumber: webhook.trackingNumber,
    });

    return webhook;
  }

  async findWebhookById(id: string): Promise<WebhookRegistration | null> {
    return await this.prisma.webhookRegistration.findUnique({
      where: { id },
    });
  }

  async findActiveWebhooks(): Promise<WebhookRegistration[]> {
    return await this.prisma.webhookRegistration.findMany({
      where: { active: true },
      orderBy: { lastCheckedAt: "asc" },
    });
  }

  async findWebhooksDueForCheck(limit = 100): Promise<WebhookRegistration[]> {
    const fiveMinutesAgo = DateTime.now().minus({ minutes: 5 }).toJSDate();

    return await this.prisma.webhookRegistration.findMany({
      where: {
        active: true,
        OR: [
          { lastCheckedAt: null },
          { lastCheckedAt: { lt: fiveMinutesAgo } },
        ],
      },
      orderBy: { lastCheckedAt: "asc" },
      take: limit,
    });
  }

  async findExpiredWebhooks(): Promise<WebhookRegistration[]> {
    const now = DateTime.now().toJSDate();

    return await this.prisma.webhookRegistration.findMany({
      where: {
        active: true,
        expirationTime: { lt: now },
      },
    });
  }

  async updateWebhook(
    id: string,
    input: UpdateWebhookInput
  ): Promise<WebhookRegistration> {
    try {
      const webhook = await this.prisma.webhookRegistration.update({
        where: { id },
        data: input,
      });

      this.logger.debug("Webhook updated", { webhookId: id, updates: input });

      return webhook;
    } catch (error) {
      this.logger.error("Failed to update webhook", { webhookId: id, error });
      throw new WebhookNotFoundError(id);
    }
  }

  async deactivateWebhook(id: string): Promise<void> {
    await this.updateWebhook(id, { active: false });
    this.logger.info("Webhook deactivated", { webhookId: id });
  }

  async deactivateExpiredWebhooks(): Promise<number> {
    const expiredWebhooks = await this.findExpiredWebhooks();

    for (const webhook of expiredWebhooks) {
      await this.deactivateWebhook(webhook.id);
    }

    this.logger.info("Expired webhooks deactivated", {
      count: expiredWebhooks.length,
    });

    return expiredWebhooks.length;
  }

  async logDelivery(input: LogDeliveryInput): Promise<WebhookDeliveryLog> {
    const log = await this.prisma.webhookDeliveryLog.create({
      data: input,
    });

    this.logger.info("Delivery logged", {
      webhookId: input.webhookRegistrationId,
      attemptNumber: input.attemptNumber,
      success: input.success,
    });

    return log;
  }

  async getDeliveryLogs(
    webhookRegistrationId: string,
    limit = 10
  ): Promise<WebhookDeliveryLog[]> {
    return await this.prisma.webhookDeliveryLog.findMany({
      where: { webhookRegistrationId },
      orderBy: { deliveredAt: "desc" },
      take: limit,
    });
  }

  async incrementDeliveryAttempts(id: string): Promise<WebhookRegistration> {
    const webhook = await this.findWebhookById(id);
    if (!webhook) {
      throw new WebhookNotFoundError(id);
    }

    return await this.updateWebhook(id, {
      deliveryAttempts: webhook.deliveryAttempts + 1,
      lastDeliveryAt: new Date(),
    });
  }
}
