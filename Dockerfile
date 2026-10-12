# Ciro web client + API proxy. Published to ghcr.io/kllcoco/ciro-client.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npx tsc --noEmit && npx vite build

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 CIRO_WORKSPACE_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s CMD wget -qO- http://127.0.0.1:8787/api/status >/dev/null || exit 1
LABEL org.opencontainers.image.source="https://github.com/kllcoco/frontend-UI" \
      org.opencontainers.image.description="Ciro AI client (web UI + OpenAI-compatible proxy)" \
      org.opencontainers.image.licenses="UNLICENSED"
CMD ["node", "server/index.mjs"]
