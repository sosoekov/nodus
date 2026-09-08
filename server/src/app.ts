import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import authPlugin from './auth/plugin';
import { authRoutes } from './auth/routes';
import { config } from './config';
import { pool } from './db';
import { HttpError } from './errors';
import { dictionaryRoutes } from './routes/dictionaries';

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
    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Внутренняя ошибка' });
  });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(dictionaryRoutes);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  return app;
}
