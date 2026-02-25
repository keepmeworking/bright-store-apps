FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Build argument for dynamic app selection
ARG APP_NAME

# Enable corepack to respect packageManager version in package.json
RUN corepack enable

# Copy source code
COPY . .

# Install only selected app + its workspace deps to avoid pulling unrelated packages
RUN test -n "${APP_NAME}" && pnpm install --frozen-lockfile --filter ${APP_NAME}...

# Build the project
# Reuse deps stage so pnpm/corepack state and installed deps are already available.
FROM deps AS builder

# Build arguments for dynamic app selection
ARG APP_NAME
ARG APP_DIR

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# DUMMY ENV VARS for build-time validation
# These apps often use zod to validate envs during 'next build'
ENV SECRET_KEY=placeholder
ENV DYNAMODB_MAIN_TABLE_NAME=placeholder
ENV DYNAMODB_LOGS_TABLE_NAME=placeholder
ENV AWS_REGION=us-east-1
ENV AWS_ACCESS_KEY_ID=placeholder
ENV AWS_SECRET_ACCESS_KEY=placeholder
ENV REQUEST_SECRET=placeholder
ENV APP_API_BASE_URL=https://placeholder.com
# Some apps might need these
ENV API_URL=https://placeholder.com/graphql/
ENV APP_MOUNT_URI=/

# Build the specific app
RUN test -n "${APP_NAME}" && pnpm --filter ${APP_NAME} build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Build arguments repeat for runner stage
ARG APP_DIR

COPY --from=builder /app/apps/${APP_DIR}/public ./apps/${APP_DIR}/public

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/apps/${APP_DIR}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/${APP_DIR}/.next/static ./apps/${APP_DIR}/.next/static

# Pre-create data directory for persistence and set permissions
RUN mkdir -p /app/.data && chown -R nextjs:nodejs /app/.data

USER nextjs

EXPOSE 3000

ENV PORT=3000
# Set dynamic start command
ENV APP_DIR_ENV=${APP_DIR}
CMD ["sh", "-c", "if [ -f apps/${APP_DIR_ENV}/server.js ]; then node apps/${APP_DIR_ENV}/server.js; else node server.js; fi"]
