# Stage 1: Build
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./

RUN npm install -g pnpm@9 && pnpm install

COPY . .

RUN pnpm build

# Stage 2: Serve
FROM nginx:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
