import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { conflict, notFound } from '../errors';
import {
  acquireLock,
  beatLock,
  findFreshLock,
  type LockEntityType,
  releaseLock,
} from '../repo/locks';

const LOCK_PARAMS = {
  type: 'object',
  required: ['entityType', 'id'],
  properties: {
    entityType: { type: 'string', enum: ['object', 'mechanism'] },
    id: { type: 'string', format: 'uuid' },
  },
} as const;

interface LockParams {
  entityType: LockEntityType;
  id: string;
}

export async function lockRoutes(app: FastifyInstance): Promise<void> {
  const editor = app.requireRole('editor');

  app.post<{ Params: LockParams; Body?: { force?: boolean } }>(
    '/api/locks/:entityType/:id',
    {
      onRequest: [editor],
      schema: {
        params: LOCK_PARAMS,
        body: {
          type: 'object',
          properties: { force: { type: 'boolean', default: false } },
          nullable: true,
        },
      },
    },
    async (request) => {
      const { entityType, id } = request.params;
      const force = request.body?.force ?? false;

      const lock = await acquireLock(pool, entityType, id, request.currentUser!.id, force);
      if (lock) return { lock };

      // Блокировка занята и свежая. Это не запрет: клиент показывает баннер и
      // может прислать force, если пользователь выбрал «все равно редактировать».
      const holder = await findFreshLock(pool, entityType, id);
      throw conflict('Запись сейчас редактирует другой пользователь', { lock: holder });
    },
  );

  app.post<{ Params: LockParams }>(
    '/api/locks/:entityType/:id/beat',
    { onRequest: [editor], schema: { params: LOCK_PARAMS } },
    async (request) => {
      const { entityType, id } = request.params;

      const lock = await beatLock(pool, entityType, id, request.currentUser!.id);
      if (lock) return { lock };

      // Блокировку перебили силой или она протухла и досталась другому —
      // редактор должен об этом узнать, а не продолжать думать, что держит ее.
      const holder = await findFreshLock(pool, entityType, id);
      if (holder) throw conflict('Блокировку перехватил другой пользователь', { lock: holder });
      throw notFound('Блокировка не найдена — возьмите ее заново');
    },
  );

  app.delete<{ Params: LockParams }>(
    '/api/locks/:entityType/:id',
    { onRequest: [editor], schema: { params: LOCK_PARAMS } },
    async (request) => {
      const { entityType, id } = request.params;
      const released = await releaseLock(pool, entityType, id, request.currentUser!.id);
      return { released };
    },
  );
}
