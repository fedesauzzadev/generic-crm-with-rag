# syntax=docker/dockerfile:1
# ---- build: compila SPA (admin/dist) + server (server/dist) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY admin/package.json admin/
COPY server/package.json server/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: solo prod deps + artefactos ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY admin/package.json admin/
COPY server/package.json server/
# better-sqlite3 trae prebuilt para linux glibc — sin toolchain extra.
RUN npm ci --omit=dev
COPY --from=build /app/admin/dist ./public
COPY --from=build /app/server/dist ./server/dist
COPY db/migrations ./db/migrations
ENV PORT=8787
EXPOSE 8787
# La DB se auto-crea/migra/seede en db/data al primer arranque (H-01).
CMD ["node", "server/dist/index.js"]
