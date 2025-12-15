import type * as winston from "winston";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import {
  ApolloServerErrorCode,
  unwrapResolverError,
} from "@apollo/server/errors";
import { typeDefs, resolvers, type AppContext } from "@delivery-tracker/api";
import {
  DefaultCarrierRegistry,
  logger as coreLogger,
} from "@delivery-tracker/core";
import { initLogger } from "./logger";

const serverRootLogger: winston.Logger = coreLogger.rootLogger.child({
  module: "server",
});

const server = new ApolloServer({
  typeDefs,
  resolvers: resolvers.resolvers,
  formatError: (formattedError, error) => {
    const extensions = formattedError.extensions ?? {};
    switch (extensions.code) {
      case "INTERNAL":
      case "BAD_REQUEST":
      case "NOT_FOUND":
      case ApolloServerErrorCode.INTERNAL_SERVER_ERROR:
        extensions.code = "INTERNAL";
        break;
      case ApolloServerErrorCode.GRAPHQL_PARSE_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_FOUND:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_SUPPORTED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.BAD_USER_INPUT:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.OPERATION_RESOLUTION_FAILURE:
        extensions.code = "BAD_REQUEST";
        break;
      default:
        extensions.code = "INTERNAL";
        break;
    }

    if (extensions.code === "INTERNAL") {
      serverRootLogger.error("internal error response", {
        formattedError,
        error: unwrapResolverError(error),
      });
    }

    return {
      ...formattedError,
      extensions,
      message:
        extensions.code === "INTERNAL"
          ? "Internal error"
          : formattedError.message,
    };
  },
});

async function main(): Promise<void> {
  const carrierRegistry = new DefaultCarrierRegistry();
  await carrierRegistry.init();

  // Initialize webhook service if enabled
  let webhookService: any | undefined;
  if (process.env.ENABLE_WEBHOOKS === "true") {
    serverRootLogger.info("Initializing webhook service...");

    // Dynamic import to avoid MODULE_NOT_FOUND when webhooks are disabled
    const { WebhookService, QueueManager } = await import("@delivery-tracker/webhook");

    const queueManager = new QueueManager();
    await queueManager.init({
      redis: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined,
      },
      trackingMonitorInterval: process.env.TRACKING_MONITOR_INTERVAL
        ? parseInt(process.env.TRACKING_MONITOR_INTERVAL, 10)
        : undefined,
    });

    webhookService = new WebhookService({
      databaseUrl: process.env.WEBHOOK_DATABASE_URL ?? "file:./webhook.db",
      carrierRegistry,
      queueManager,
      cache: {
        ttl: process.env.CACHE_TTL
          ? parseInt(process.env.CACHE_TTL, 10)
          : undefined,
        maxSize: process.env.CACHE_MAX_SIZE
          ? parseInt(process.env.CACHE_MAX_SIZE, 10)
          : undefined,
      },
    });
    await webhookService.init();

    serverRootLogger.info("Webhook service initialized successfully");
  } else {
    serverRootLogger.info("Webhook service disabled (ENABLE_WEBHOOKS not set to 'true')");
  }

  const appContext: AppContext = {
    carrierRegistry,
    webhookService,
  };

  const { url } = await startStandaloneServer(server, {
    context: async ({ req, res }) => ({
      appContext,
    }),
  });
  serverRootLogger.info(`🚀 Server ready at ${url}`);
}

initLogger();
main().catch((err) => {
  serverRootLogger.error("Uncaught error", {
    error: err,
  });
});
