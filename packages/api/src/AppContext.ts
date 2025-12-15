import { type CarrierRegistry } from "@delivery-tracker/core";
import { type WebhookService } from "@delivery-tracker/webhook";

interface AppContext {
  carrierRegistry: CarrierRegistry;
  webhookService?: WebhookService;
}

export type { AppContext };
