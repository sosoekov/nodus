import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { unauthorized } from '../errors';

export async function dictionaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dictionaries', async (request) => {
    if (!request.currentUser) throw unauthorized();

    const [types, categories, roles] = await Promise.all([
      pool.query('SELECT code, title, color, sort_order FROM object_types ORDER BY sort_order'),
      pool.query('SELECT code, title, sort_order FROM mechanism_categories ORDER BY sort_order'),
      pool.query(
        'SELECT code, title, direction, sort_order FROM participant_roles ORDER BY sort_order',
      ),
    ]);

    return {
      object_types: types.rows,
      mechanism_categories: categories.rows,
      participant_roles: roles.rows,
    };
  });
}
