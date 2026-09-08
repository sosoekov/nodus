# Образ намеренно включает devDependencies: контейнер сам прогоняет миграции
# (node-pg-migrate + ts-node) и сид (tsx) перед стартом.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
