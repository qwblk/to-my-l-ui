# syntax=docker/dockerfile:1.7

# === Stage 1: build the SPA ===
# Build args let docker-compose / CI pass the public Vite env vars at
# build time. They are inlined into the bundle (Vite limitation: only
# import.meta.env.VITE_* prefixed vars), so different environments must
# rebuild. Defaults match the dev contract: relative /api, etc.
FROM node:22-alpine AS build

ARG VITE_API_BASE=/api
ARG VITE_WS_BASE=
ARG VITE_CURRENT_USER_ID=1
ARG VITE_PARTNER_USER_ID=2
ARG VITE_CURRENT_USER_NAME=
ARG VITE_PARTNER_USER_NAME=
ARG VITE_CURRENT_USERNAMES=
ARG VITE_PARTNER_USERNAMES=
ARG VITE_SINCE_DATE=
ARG VITE_PARTNER_BIRTHDAY_MMDD=

ENV VITE_API_BASE=${VITE_API_BASE} \
    VITE_WS_BASE=${VITE_WS_BASE} \
    VITE_CURRENT_USER_ID=${VITE_CURRENT_USER_ID} \
    VITE_PARTNER_USER_ID=${VITE_PARTNER_USER_ID} \
    VITE_CURRENT_USER_NAME=${VITE_CURRENT_USER_NAME} \
    VITE_PARTNER_USER_NAME=${VITE_PARTNER_USER_NAME} \
    VITE_CURRENT_USERNAMES=${VITE_CURRENT_USERNAMES} \
    VITE_PARTNER_USERNAMES=${VITE_PARTNER_USERNAMES} \
    VITE_SINCE_DATE=${VITE_SINCE_DATE} \
    VITE_PARTNER_BIRTHDAY_MMDD=${VITE_PARTNER_BIRTHDAY_MMDD}

WORKDIR /app

# Cache the dependency layer separately from app source.
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm build

# === Stage 2: serve via nginx with reverse proxy ===
FROM nginx:stable-alpine

# nginx.conf already includes /api, /ws, /upload, /static reverse proxy
# rules pointing at the upstream "backend:8081" — the docker-compose
# service name. If you deploy nginx without compose, point an upstream
# entry at your real backend host instead.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
