# Nodus — граф связей объектов конфигурации

Внутренний сервис, в котором команда вручную документирует, как объекты учётной
системы влияют друг на друга.

Ключевая идея модели: **связь — это не ребро между двумя объектами, а механизм,
в котором участвует несколько объектов, каждый в своей роли**. Граф двудольный:
узлы-объекты и узлы-механизмы, участие объекта в механизме — ребро с ролью.

## Стек

PostgreSQL 16 · Node.js + Fastify + TypeScript (драйвер `pg`, миграции
`node-pg-migrate`) · React + Vite · graphology + sigma.js · Tailwind ·
сессионная cookie, роли viewer / editor / admin · docker-compose.

## Запуск через docker-compose

```bash
cp .env.example .env
# обязательно поменяйте SESSION_SECRET
docker compose up --build
```

Контейнер `api` сам прогоняет миграции и сид, затем поднимает сервер на
`http://localhost:3000`.

## Локальный запуск без docker

Нужен работающий PostgreSQL 16.

```bash
createdb nodus                       # или psql -c 'create database nodus'
cd server
npm install

export DATABASE_URL=postgres://nodus:nodus@localhost:5432/nodus
export SESSION_SECRET=dev-secret-change-me-to-something-long

npm run migrate:up                   # миграции
npm run seed                         # справочники, пользователи, фикстура
npm run dev                          # http://localhost:3000
```

### Учётки после сида

Пароль берётся из `SEED_PASSWORD`, по умолчанию `nodus`.

| email                | роль   |
| -------------------- | ------ |
| `admin@nodus.local`  | admin  |
| `editor@nodus.local` | editor |
| `viewer@nodus.local` | viewer |

Сид также заводит фикстуру из ТЗ — три объекта и механизм
«Определение нормы срока подбора».

## Миграции

Отдельный файл на изменение, каждая откатывается.

```bash
npm run migrate:up             # применить все
npm run migrate:down           # откатить одну
npm run migrate:down -- 10     # откатить десять
npx node-pg-migrate -m migrations create my_change -j ts   # новая миграция
```

TypeScript-миграции исполняются напрямую — Node 22 умеет снимать типы сам,
дополнительный транспайлер не нужен.

## Тесты

Покрывается только бэкенд: инварианты, версионирование, журнал изменений,
мягкое удаление.

```bash
cd server
npm test
```

Тесты работают на отдельной базе (по умолчанию `nodus_test`, переопределяется
через `TEST_DATABASE_URL`). База создаётся и мигрируется автоматически перед
запуском.

## Переменные окружения

| Переменная            | По умолчанию | Назначение                                        |
| --------------------- | ------------ | ------------------------------------------------- |
| `DATABASE_URL`        | —            | строка подключения к PostgreSQL                   |
| `SESSION_SECRET`      | —            | ключ подписи сессионной cookie, обязательно свой  |
| `PORT`                | `3000`       | порт HTTP                                         |
| `HOST`                | `0.0.0.0`    | интерфейс                                         |
| `COOKIE_SECURE`       | `false`      | `true`, если сервис за HTTPS                      |
| `SESSION_TTL_SECONDS` | `1209600`    | срок жизни сессии, 14 суток                       |
| `SEED_PASSWORD`       | `nodus`      | пароль сидовых учёток                             |
| `LOG_LEVEL`           | `info`       | уровень логирования                               |

## Структура

```
server/
  migrations/        миграции node-pg-migrate, по файлу на изменение
  src/
    auth/            пароли (scrypt), сессионный плагин, роуты входа
    repo/            работа с БД, журнал changes
    routes/          HTTP-роуты
    seed/            справочники, пользователи, фикстура
  tests/             тесты бэкенда (vitest)
```

## Состояние по этапам

- [x] Этап 1 — docker-compose, миграции, справочники, сид, аутентификация и роли
- [ ] Этап 2 — CRUD объектов и механизмов, журнал `changes`, оптимистичная
      блокировка, мягкое удаление
- [ ] Этап 3 — SSE, `/api/changes`, мягкие блокировки
- [ ] Этап 4 — поиск, карточка объекта, редактор механизма, массовый ввод
- [ ] Этап 5 — снапшот графа, локальный граф
- [ ] Этап 6 — полный граф, раскладка, пути, анализ влияния, очередь
