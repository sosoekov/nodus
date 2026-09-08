import type { FastifyInstance } from 'fastify';
import { pool } from '../db';

/**
 * Рабочий список команды: что заведено, но не описано. Три разных повода
 * вернуться к записи, поэтому три отдельных списка, а не один вперемешку.
 */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');

  app.get<{ Querystring: { limit?: number } }>(
    '/api/queue/incomplete',
    {
      onRequest: [viewer],
      schema: {
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        },
      },
    },
    async (request) => {
      const { limit = 100 } = request.query;

      const stubs = await pool.query(
        `SELECT id, slug, name, full_name, type_code, status, updated_at
           FROM objects
          WHERE deleted_at IS NULL AND status = 'stub'
          ORDER BY updated_at DESC
          LIMIT $1`,
        [limit],
      );

      // Объект без единого участия: он есть в базе, но в графе изолирован.
      const unlinked = await pool.query(
        `SELECT o.id, o.slug, o.name, o.full_name, o.type_code, o.status, o.updated_at
           FROM objects o
          WHERE o.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM mechanism_participants p
               JOIN mechanisms m ON m.id = p.mechanism_id AND m.deleted_at IS NULL
              WHERE p.object_id = o.id
            )
          ORDER BY o.updated_at DESC
          LIMIT $1`,
        [limit],
      );

      const emptyBody = await pool.query(
        `SELECT id, title, category_code, status, summary, updated_at
           FROM mechanisms
          -- Не btrim: он убирает только пробелы, и тело из одних переводов
          -- строки считалось бы заполненным. Проверяем наличие хоть одного
          -- непробельного символа.
          WHERE deleted_at IS NULL AND (body IS NULL OR body !~ '\\S')
          ORDER BY updated_at DESC
          LIMIT $1`,
        [limit],
      );

      // Механизм без участников в граф не попадает вовсе — это заметка, а не связь.
      const withoutParticipants = await pool.query(
        `SELECT m.id, m.title, m.category_code, m.status, m.summary, m.updated_at
           FROM mechanisms m
          WHERE m.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM mechanism_participants p WHERE p.mechanism_id = m.id)
          ORDER BY m.updated_at DESC
          LIMIT $1`,
        [limit],
      );

      return {
        stubs: stubs.rows,
        unlinked_objects: unlinked.rows,
        mechanisms_without_body: emptyBody.rows,
        mechanisms_without_participants: withoutParticipants.rows,
      };
    },
  );
}
