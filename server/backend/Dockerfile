# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.test.json jest.config.js ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM builder AS test
RUN npm run test:coverage

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/app/storage

COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/storage

EXPOSE 4000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
