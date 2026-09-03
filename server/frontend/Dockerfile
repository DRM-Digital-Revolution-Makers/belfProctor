# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM builder AS test
RUN npm run lint && npm test

FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
