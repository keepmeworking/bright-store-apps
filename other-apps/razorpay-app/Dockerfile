FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable corepack to respect packageManager version in package.json
RUN corepack enable

# Copy dependency files first (for Docker layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the project
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# DUMMY ENV VARS for build-time validation
ENV SECRET_KEY=placeholder
ENV RAZORPAY_KEY_ID=placeholder
ENV RAZORPAY_KEY_SECRET=placeholder
ENV RAZORPAY_WEBHOOK_SECRET=placeholder
ENV APP_API_BASE_URL=https://placeholder.com
ENV APP_IFRAME_BASE_URL=https://placeholder.com

RUN corepack enable
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Pre-create data directory for persistence
RUN mkdir -p /app/.data && chown -R nextjs:nodejs /app/.data

USER nextjs

EXPOSE 3000

ENV PORT=3000
CMD ["node", "server.js"]
