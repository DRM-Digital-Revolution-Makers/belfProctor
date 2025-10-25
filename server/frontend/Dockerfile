# Frontend multi-stage: build with Node, serve with Nginx
FROM node:18-alpine AS builder
WORKDIR /app

# Install deps
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
    else npm i; fi

# Copy sources and build
COPY . .
RUN npm run build

# Runtime image
FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
# Provide default server configuration
RUN printf "server {\n  listen 80;\n  server_name localhost;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n" > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]