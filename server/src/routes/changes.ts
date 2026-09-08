import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import type { ChangeEvent } from '../events/bus';

const MAX_LIMIT = 5000;

export async function changeRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');

  app.get<{ Querystring: { since?: number; limit?: number } }>(
    '/api/changes',
    {
      onRequest: [viewer],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 1000 },
          },
        },
      },
    },
    async (request) => {
      const { since = 0, limit = 1000 } = request.query;

      const { rows } = await pool.query<ChangeEvent>(
        `SELECT seq, entity_type, entity_id, op, payload, user_id, created_at
           FROM changes WHERE seq > $1 ORDER BY seq LIMIT $2`,
        [since, limit],
      );

      const { rows: head } = await pool.query<{ seq: number | null }>(
        'SELECT max(seq) AS seq FROM changes',
      );
      const latest = head[0].seq ?? 0;

      // Страница уперлась в лимит — клиенту нужно позвать еще раз с новым since.
      const cursor = rows.length ? rows[rows.length - 1].seq : since;

      return {
        changes: rows,
        seq: cursor,
        latest_seq: latest,
        has_more: cursor < latest,
      };
    },
  );
}
