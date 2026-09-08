# Фронтенд собирается здесь же и кладется внутрь образа API: инстанс один,
# отдавать статику вторым контейнером значило бы разводить CORS и SameSite для
# сессионной cookie на ровном месте.
FROM node:22-alpine AS web

WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Образ намеренно включает devDependencies: контейнер сам прогоняет миграции
# (node-pg-migrate) и сид (tsx) перед стартом.
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/migrations ./migrations
COPY server/src ./src

RUN npm run build

COPY --from=web /web/dist ./public
ENV WEB_DIST=/app/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
