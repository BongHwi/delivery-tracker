# Delivery Tracker

Delivery and Shipping Tracking Service

## Usage
### Cloud (Managed Service)
Visit : https://tracker.delivery/docs/try

### Self-Hosted
#### Setting Up the Development Environment
Delivery Tracker can be set up in local development environments and is also readily available for setup through GitHub Codespaces.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/shlee322/delivery-tracker)

Follow the instructions below for GitHub Codespaces:

1. Click the "Open in GitHub Codespaces" button above to create a new Codespace.
2. Once in your Codespace terminal, enter `pnpm install` to install the necessary dependencies.
3. In GitHub Codespaces, navigate to the "Run and Debug" section from the sidebar and then click the "Run" button for "@delivery-tracker/server" to launch the server.
4. The service URL can be accessed via the Ports panel at the bottom of the GitHub Codespaces interface.

#### Deploying Self-Hosted Services

##### Using Docker Compose (Recommended)

The easiest way to deploy Delivery Tracker is using Docker Compose:

```bash
# 1. Clone the repository
git clone https://github.com/shlee322/delivery-tracker.git
cd delivery-tracker

# 2. Configure environment variables (optional)
cp .env.example .env
# Edit .env to customize settings (port, webhook features, etc.)

# 3. Start the services
docker compose up -d

# 4. Access the GraphQL API
# The server will be available at http://localhost:4000
```

**With Webhooks Enabled:**

```bash
# Create .env file with webhook support
cat > .env << EOF
ENABLE_WEBHOOKS=true
PORT=4000
REDIS_HOST=redis
REDIS_PORT=6379
WEBHOOK_DATABASE_URL=file:/data/webhook.db
EOF

# Start services
docker compose up -d
```

##### Using Docker

```bash
# Build the image
docker build -t delivery-tracker .

# Run without webhooks
docker run -p 4000:4000 delivery-tracker

# Run with webhooks (requires Redis)
docker network create delivery-tracker-net
docker run -d --name redis --network delivery-tracker-net redis:7-alpine
docker run -d --name server --network delivery-tracker-net -p 4000:4000 \
  -e ENABLE_WEBHOOKS=true \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e WEBHOOK_DATABASE_URL=file:/data/webhook.db \
  delivery-tracker
```

##### Managing Services

```bash
# View logs
docker compose logs -f server

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v

# Rebuild after code changes
docker compose up -d --build
```

## Additional Information
### License
- Please read the `LICENSE` file.

### Contact
- Please contact `contact@tracker.delivery` for more information.

### Project Structure
- packages/api : GraphQL API
- packages/core : Scraper code
- packages/cli : A Command Line Interface (CLI) tool that uses the execute function from packages/api.
- packages/http : A self-hosted GraphQL HTTP server that uses the execute function from packages/api.

### Request additional carriers
See https://tracker.delivery/request-additional-carrier
