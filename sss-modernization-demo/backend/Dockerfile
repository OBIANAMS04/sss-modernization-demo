# Backend Build Stage
FROM node:26.7-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Backend Runtime Stage
FROM node:26.7-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
# STORY-016: the compiled access policy (read from ../../policy relative to dist/services)
COPY --from=builder /app/policy ./policy
# STORY-017: the synthetic policy documents the assistant answers from (read from ../../policy-docs relative to dist/services)
COPY --from=builder /app/policy-docs ./policy-docs

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "dist/index.js"]
