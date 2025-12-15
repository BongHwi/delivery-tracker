#!/bin/sh
set -e

# Run database migrations if webhook service is enabled
if [ "$ENABLE_WEBHOOKS" = "true" ]; then
  echo "Running webhook database migrations..."
  cd /app/packages/webhook
  npx prisma@5.22.0 db push --skip-generate
  cd /app/packages/server
fi

# Start the server
exec "$@"
