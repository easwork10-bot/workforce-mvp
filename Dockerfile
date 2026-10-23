# Multi-stage Dockerfile for Workforce MVP
# Development stage
FROM node:24-alpine AS development

WORKDIR /app

RUN apk add --no-cache python3 make g++ libstdc++

COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

# Production builder stage
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN mkdir -p public
RUN npm run build

# Runner stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install runtime dependencies for argon2
RUN apk add --no-cache libstdc++

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy runtime dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle

# Copy package.json for runtime
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV SHIFT_REMINDER_JOB_ENABLED=true

CMD ["node", "server.js"]