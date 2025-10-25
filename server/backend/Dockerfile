# Backend Dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# Install deps
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN npm ci --only=production || npm i --production

# Copy prisma and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm i -D typescript && npx tsc

ENV NODE_ENV=production
ENV PORT=4000
ENV UPLOAD_DIR=/data/storage

# Create storage directory
RUN mkdir -p /data/storage/screenshots /data/storage/reports

EXPOSE 4000
CMD ["node", "dist/index.js"]