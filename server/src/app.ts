import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import authPlugin from './auth/plugin';
import { authRoutes } from './auth/routes';
import { config } from './config';
import { pool } from './db';
import { HttpError } from './errors';
import { changeRoutes } from './routes/changes';
import { dictionaryRoutes } from './routes/dictionaries';
import { graphRoutes } from './routes/graph';
import { eventRoutes } from './routes/events';
import { lockRoutes } from './routes/locks';
import { mechanismRoutes } from './routes/mechanisms';
import { objectRoutes } from './routes/objects';
import { spaRoutes } from './routes/spa';

/** Ограничения БД — часть контракта, а не «внутренняя ошибка»: переводим их в 4xx. */
const PG_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  '23503': { status: 400, code: 'bad_request', message: 'Ссылка на несуществующую запись' },
  '23505': { status: 409, code: 'conflict', message: 'Такая запись уже есть' },
  '23514': { status: 400, code: 'bad_request', message: 'Значение нарушает ограничение' },
  '22P02': { status: 400, code: 'bad_request', message: 'Некорректный формат значения' },
};

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    ajv: { customOptions: { coerceTypes: true, removeAdditional: 'all' } },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details });
    }
    if (error.validation) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: error.message, details: error.validation });
    }

    const mapped = PG_ERROR_STATUS[(error as { code?: string }).code ?? ''];
    if (mapped) {
      request.log.warn({ err: error }, 'ограничение БД');
      return reply.code(mapped.status).send({
        error: mapped.code,
        message: mapped.message,
        details: { constraint: (error as { constraint?: string }).constraint, detail: error.message },
      });
    }

    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Внутренняя ошибка' });
  });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(dictionaryRoutes);
  await app.register(objectRoutes);
  await app.register(mechanismRoutes);
  await app.register(graphRoutes);
  await app.register(changeRoutes);
  await app.register(eventRoutes);
  await app.register(lockRoutes);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  // Последним: он ставит обработчик 404 для клиентской маршрутизации.
  await app.register(spaRoutes);

  return app;
}
