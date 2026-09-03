# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/app/storage

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/storage

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
