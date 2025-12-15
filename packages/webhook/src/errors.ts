export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export class WebhookValidationError extends WebhookError {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}

export class WebhookNotFoundError extends WebhookError {
  constructor(webhookId: string) {
    super(`Webhook registration not found: ${webhookId}`);
    this.name = "WebhookNotFoundError";
  }
}

export class WebhookDeliveryError extends WebhookError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = "WebhookDeliveryError";
  }
}
