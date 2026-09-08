import type { FastifyInstance } from 'fastify';
import { pool } from '../db';

/**
 * Весь граф одним ответом. Только легкие поля: description объектов и body
 * механизмов сюда не попадают — на 1000+ объектов они раздули бы ответ в
 * десятки мегабайт. Тяжелое подгружается по клику через карточки.
 */
export async function graphRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');

  app.get('/api/graph/snapshot', { onRequest: [viewer] }, async () => {
    // Один снимок на одной транзакции: иначе между запросами может пройти
    // правка, и участники будут ссылаться на механизм, которого нет в выдаче.
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const objects = await client.query(
        // subsystem сверх списка полей из ТЗ: без него фильтр по подсистеме на
        // полном графе нечем считать на клиенте. Поле легкое, в отличие от
        // description и body, ради которых ограничение и вводилось.
        `SELECT o.id, o.slug, o.name, o.type_code, o.status, o.tags, o.parent_id, o.subsystem,
                l.x, l.y, l.pinned
           FROM objects o
           LEFT JOIN layout l ON l.object_id = o.id
          WHERE o.deleted_at IS NULL
          ORDER BY o.name`,
      );

      const mechanisms = await client.query(
        `SELECT id, title, category_code, status, summary
           FROM mechanisms WHERE deleted_at IS NULL ORDER BY title`,
      );

      // Участники живых механизмов и живых объектов: мягко удаленный с обеих
      // сторон оставил бы в графе ребро в никуда.
      const participants = await client.query(
        // id нужен клиенту, чтобы сопоставлять патчи участников из SSE с уже
        // загруженным составом: тройка (механизм, объект, роль) в патче
        // обновления может смениться целиком.
        `SELECT p.id, p.mechanism_id, p.object_id, p.role_code
           FROM mechanism_participants p
           JOIN mechanisms m ON m.id = p.mechanism_id AND m.deleted_at IS NULL
           JOIN objects o ON o.id = p.object_id AND o.deleted_at IS NULL
          ORDER BY p.sort_order`,
      );

      const head = await client.query<{ seq: number | null }>(
        'SELECT max(seq) AS seq FROM changes',
      );

      await client.query('COMMIT');

      return {
        seq: head.rows[0].seq ?? 0,
        objects: objects.rows,
        mechanisms: mechanisms.rows,
        participants: participants.rows,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
