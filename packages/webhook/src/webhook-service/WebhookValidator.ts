import { z } from "zod";
import { DateTime } from "luxon";
import { WebhookValidationError } from "../errors";

const ALLOWED_PROTOCOLS = ["https:", "http:"];
const MAX_EXPIRATION_DAYS = 30;

export const RegisterWebhookInputSchema = z.object({
  carrierId: z.string().min(1, "Carrier ID is required"),
  trackingNumber: z.string().min(1, "Tracking number is required"),
  callbackUrl: z.string().url("Callback URL must be a valid URL"),
  expirationTime: z.date().refine(
    (date) => {
      const now = DateTime.now();
      const expiration = DateTime.fromJSDate(date);
      const diff = expiration.diff(now, "days").days;

      return diff > 0 && diff <= MAX_EXPIRATION_DAYS;
    },
    {
      message: `Expiration time must be between now and ${MAX_EXPIRATION_DAYS} days in the future`,
    }
  ),
});

export type RegisterWebhookInput = z.infer<typeof RegisterWebhookInputSchema>;

export class WebhookValidator {
  /**
   * Validates webhook registration input
   * @throws {WebhookValidationError} if validation fails
   */
  static validateRegistrationInput(input: unknown): RegisterWebhookInput {
    const result = RegisterWebhookInputSchema.safeParse(input);

    if (!result.success) {
      const errors = result.error.errors.map((e) => e.message).join(", ");
      throw new WebhookValidationError(`Validation failed: ${errors}`);
    }

    // Additional URL validation
    try {
      const url = new URL(result.data.callbackUrl);

      // Check protocol
      if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
        throw new WebhookValidationError(
          `Callback URL protocol must be HTTP or HTTPS (got: ${url.protocol})`
        );
      }

      // Prevent localhost/private IPs in production
      if (
        process.env.NODE_ENV === "production" &&
        (url.hostname === "localhost" ||
          url.hostname === "127.0.0.1" ||
          url.hostname.startsWith("192.168.") ||
          url.hostname.startsWith("10.") ||
          url.hostname.startsWith("172."))
      ) {
        throw new WebhookValidationError(
          "Callback URL cannot point to localhost or private IP addresses"
        );
      }
    } catch (error) {
      if (error instanceof WebhookValidationError) {
        throw error;
      }
      throw new WebhookValidationError(
        `Invalid callback URL: ${(error as Error).message}`
      );
    }

    return result.data;
  }

  /**
   * Validates that a carrier ID exists in the registry
   */
  static validateCarrierId(
    carrierId: string,
    validCarrierIds: string[]
  ): void {
    if (!validCarrierIds.includes(carrierId)) {
      throw new WebhookValidationError(
        `Invalid carrier ID: ${carrierId}. Available carriers: ${validCarrierIds.join(", ")}`
      );
    }
  }
}
