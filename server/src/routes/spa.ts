import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';

/**
 * Собранный фронтенд отдается тем же процессом, что и API: инстанс один,
 * поэтому второй контейнер с nginx только добавил бы возню с CORS и SameSite
 * для сессионной cookie.
 *
 * В разработке фронтенд живет на vite-сервере и проксирует /api сюда, так что
 * при отсутствующей сборке плагин просто не подключается.
 */
export async function spaRoutes(app: FastifyInstance): Promise<void> {
  if (!existsSync(join(config.webDist, 'index.html'))) {
    app.log.info({ dir: config.webDist }, 'сборка фронтенда не найдена, отдаем только API');
    return;
  }

  // wildcard включен намеренно: с выключенным плагин перечисляет файлы один раз
  // при старте, и после пересборки фронтенда новые ассеты с другими хешами
  // проваливаются в фолбэк ниже — браузер получает index.html вместо модуля и
  // отказывается его исполнять.
  await app.register(fastifyStatic, { root: config.webDist });

  app.setNotFoundHandler((request, reply) => {
    // Маршруты API должны честно отвечать 404, а не отдавать index.html:
    // иначе опечатка в пути превращается в загадочный HTML вместо ошибки.
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Неизвестный эндпоинт' });
    }
    // Отсутствующий ассет тоже должен быть честным 404: если отдать сюда
    // index.html, браузер получит text/html вместо модуля и пожалуется на
    // MIME-тип — по такому сообщению не догадаешься, что файла просто нет.
    if (request.url.startsWith('/assets/')) {
      return reply.code(404).send({ error: 'not_found', message: 'Файл не найден' });
    }
    // Остальное — клиентская маршрутизация: отдаем оболочку.
    return reply.sendFile('index.html');
  });
}
