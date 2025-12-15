import { GraphQLError } from "graphql/error";
import { type GraphQLResolveInfo } from "graphql/type";
import { type AppContext } from "../AppContext";
import * as schema from "../schema/generated/resolvers-types";

async function registerTrackWebhookResolver(
  parent: undefined,
  args: schema.MutationRegisterTrackWebhookArgs,
  contextValue: { appContext: AppContext },
  info: GraphQLResolveInfo
): Promise<string> {
  const { webhookService } = contextValue.appContext;

  if (!webhookService) {
    throw new GraphQLError("Webhook service is not available", {
      extensions: {
        code: schema.ErrorCode.Internal,
      },
    });
  }

  try {
    // Convert DateTime string to Date object
    const expirationTime = new Date(args.input.expirationTime);

    const webhookId = await webhookService.registerWebhook({
      carrierId: args.input.carrierId,
      trackingNumber: args.input.trackingNumber,
      callbackUrl: args.input.callbackUrl,
      expirationTime,
    });

    return webhookId;
  } catch (error) {
    // Handle validation errors
    if (
      error instanceof Error &&
      error.name === "WebhookValidationError"
    ) {
      throw new GraphQLError(error.message, {
        extensions: {
          code: schema.ErrorCode.BadRequest,
        },
      });
    }

    // Handle other errors
    throw new GraphQLError(
      `Failed to register webhook: ${(error as Error).message}`,
      {
        extensions: {
          code: schema.ErrorCode.Internal,
        },
      }
    );
  }
}

const MutationResolvers = {
  registerTrackWebhook: registerTrackWebhookResolver,
};

export { MutationResolvers };
