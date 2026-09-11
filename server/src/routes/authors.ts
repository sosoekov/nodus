import type { FastifyInstance } from 'fastify';
import { pool } from '../db';

/**
 * Авторы, реально встречающиеся в данных, — для наполнения фильтра.
 *
 * Не список всех пользователей: фильтр по человеку, который ничего не заводил,
 * гарантированно даст пустую выдачу, и в выпадающем списке он только мешает.
 */
export async function authorRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');

  app.get('/api/authors', { onRequest: [viewer] }, async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email,
              count(*) FILTER (WHERE source = 'object')::int AS object_count,
              count(*) FILTER (WHERE source = 'mechanism')::int AS mechanism_count
         FROM (
           SELECT created_by, 'object' AS source FROM objects WHERE deleted_at IS NULL
           UNION ALL
           SELECT created_by, 'mechanism' AS source FROM mechanisms WHERE deleted_at IS NULL
         ) AS authored
         JOIN users u ON u.id = authored.created_by
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name`,
    );

    return { items: rows };
  });
}
