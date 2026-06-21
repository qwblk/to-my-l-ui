# syntax=docker/dockerfile:1.7

# === Stage 1: build the SPA ===
# Build args let docker-compose / CI pass the public Vite env vars at
# build time. They are inlined into the bundle (Vite limitation: only
# import.meta.env.VITE_* prefixed vars), so different environments must
# rebuild. Defaults match the dev contract: relative /api, etc.
#
# VITE_CURRENT_USER_ID / VITE_PARTNER_USER_ID are intentionally
# default-less — they decide who the SPA thinks each end is, and
# silently falling back to 1/2 in production would mis-identify users.
# A `RUN test -n` below turns a missing value into a build failure.
FROM node:22-alpine AS build

ARG VITE_API_BASE=/api
ARG VITE_WS_BASE=
ARG VITE_CURRENT_USER_ID
ARG VITE_PARTNER_USER_ID
ARG VITE_CURRENT_USER_NAME=
ARG VITE_PARTNER_USER_NAME=
ARG VITE_CURRENT_USERNAMES=
ARG VITE_PARTNER_USERNAMES=
ARG VITE_SINCE_DATE=
ARG VITE_PARTNER_BIRTHDAY_MMDD=

# Fail the build early if identity IDs are missing, before we waste
# time on `pnpm install` and `pnpm build`.
RUN test -n "$VITE_CURRENT_USER_ID" \
        || (echo "ERROR: VITE_CURRENT_USER_ID build arg is required" >&2 && exit 1) \
    && test -n "$VITE_PARTNER_USER_ID" \
        || (echo "ERROR: VITE_PARTNER_USER_ID build arg is required" >&2 && exit 1)

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
# `--frozen-lockfile` is intentional: a lockfile drift in production
# build should fail loudly, not silently resolve a new dependency tree.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# === Stage 2: serve via nginx with reverse proxy ===
FROM nginx:stable-alpine

# nginx.conf includes /api, /ws, /upload, /static reverse-proxy rules
# whose upstream resolves to the Docker DNS name `to-my-l-app:8081`
# (the backend's container_name). If you deploy nginx without compose,
# edit the upstream block in nginx.conf to your real backend host.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
# Probe a backend-routed path so nginx-up-but-backend-down stops
# reporting healthy. Requires backend to expose /api/health (200 OK,
# no DB hit — just a liveness signal).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
