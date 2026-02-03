#!/bin/bash

# Usage: ./deploy-app.sh <client_name> <app_name> <app_domain>
# Example: ./deploy-app.sh daikcell smtp smtp.daikcell.com

CLIENT=$1
APP=$2
DOMAIN=$3

# Path to the Monorepo (Relative to the client docker-compose file)
# We assume structure:
# root/
#   bright-apps/
#   clients/
#     client-a/
#       apps/
#         docker-compose.yml
# So path is ../../../bright-apps
MONOREPO_PATH="../../../bright-apps"

if [ -z "$CLIENT" ] || [ -z "$APP" ] || [ -z "$DOMAIN" ]; then
  echo "Usage: ./deploy-app.sh <client_name> <app_name> <app_domain>"
  exit 1
fi

# 1. Generate Secret
SECRET_KEY=$(openssl rand -hex 32)
echo "🔑 Generated Secret Use it in .env: $SECRET_KEY"

# 2. Prepare Directory
CLIENT_DIR="clients/$CLIENT/apps"
mkdir -p "$CLIENT_DIR"

# 3. Create/Append to Docker Compose
COMPOSE_FILE="$CLIENT_DIR/docker-compose.yml"

# Check if file exists, if not create header
if [ ! -f "$COMPOSE_FILE" ]; then
  cat <<EOT >> "$COMPOSE_FILE"
services:
EOT
fi

# Append Service Block
cat <<EOT >> "$COMPOSE_FILE"

  # Auto-generated service for $APP
  ${CLIENT}-${APP}:
    build:
      context: ${MONOREPO_PATH}
      dockerfile: Dockerfile.${APP}
    container_name: ${CLIENT}-${APP}
    restart: unless-stopped
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - APP_API_BASE_URL=https://${DOMAIN}
      - APL=file
    volumes:
      - ${APP}-data:/app/.data
    networks:
      - traefik-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${CLIENT}-${APP}.rule=Host(\`${DOMAIN}\`)"
      - "traefik.http.routers.${CLIENT}-${APP}.entrypoints=websecure"
      - "traefik.http.routers.${CLIENT}-${APP}.tls.certresolver=letsencrypt"
      - "traefik.http.services.${CLIENT}-${APP}.loadbalancer.server.port=3000"

volumes:
  ${APP}-data:

networks:
  traefik-network:
    external: true
EOT

echo "✅ Configuration added to $COMPOSE_FILE"
echo "🚀 Run 'docker compose -f $COMPOSE_FILE up -d --build' to deploy!"
