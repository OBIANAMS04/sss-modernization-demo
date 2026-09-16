# Frontend Build Stage
FROM node:26.7-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Frontend Runtime Stage
FROM node:26.7-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "require('http').get('http://localhost:5173', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["serve", "-s", "dist", "-l", "5173"]
