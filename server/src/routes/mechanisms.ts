import type { FastifyInstance } from 'fastify';
import { MECHANISM_COLUMNS } from '../columns';
import { pool, withTransaction } from '../db';
import { badRequest, notFound } from '../errors';
import {
  AUTHOR_DATE_PROPERTIES,
  type AuthorDateQuery,
  applyAuthorDateFilters,
} from './list-filters';
import {
  findMechanism,
  insertMechanism,
  listParticipants,
  type MechanismInput,
  type MechanismPatch,
  type MechanismRow,
  type ParticipantInput,
  replaceParticipants,
  softDeleteMechanism,
  updateMechanism,
} from '../repo/mechanisms';

const MECHANISM_BODY_PROPERTIES = {
  title: { type: 'string', minLength: 1, maxLength: 300 },
  category_code: { type: 'string', minLength: 1, maxLength: 100 },
  summary: { type: ['string', 'null'], maxLength: 200 },
  body: { type: ['string', 'null'] },
  status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
} as const;

const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

interface ListQuery extends AuthorDateQuery {
  q?: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function mechanismRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');
  const editor = app.requireRole('editor');

  app.get<{ Querystring: ListQuery }>(
    '/api/mechanisms',
    {
      onRequest: [viewer],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 300 },
            category: { type: 'string', maxLength: 100 },
            status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
            ...AUTHOR_DATE_PROPERTIES,
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request) => {
      const { q, category, status, limit = 50, offset = 0 } = request.query;
      const conditions = ['deleted_at IS NULL'];
      const values: unknown[] = [];

      const bind = (value: unknown) => `$${values.push(value)}`;

      if (category) conditions.push(`category_code = ${bind(category)}`);
      if (status) conditions.push(`status = ${bind(status)}`);

      applyAuthorDateFilters(conditions, bind, request.query);

      const trimmed = q?.trim();
      let rank = '';
      if (trimmed) {
        const queryParam = bind(trimmed);
        const likeParam = bind(`%${trimmed}%`);
        conditions.push(
          `(search_vector @@ websearch_to_tsquery('russian', ${queryParam})
            OR title ILIKE ${likeParam})`,
        );
        rank = `ts_rank(search_vector, websearch_to_tsquery('russian', ${queryParam})) DESC,`;
      }

      const { rows } = await pool.query<MechanismRow>(
        `SELECT ${MECHANISM_COLUMNS},
                (SELECT u.name FROM users u WHERE u.id = mechanisms.created_by) AS author_name
           FROM mechanisms
          WHERE ${conditions.join(' AND ')}
          ORDER BY ${rank} title
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      );

      const { rows: counted } = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM mechanisms WHERE ${conditions.join(' AND ')}`,
        values,
      );

      return { items: rows, total: counted[0].total, limit, offset };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/mechanisms/:id',
    { onRequest: [viewer], schema: { params: ID_PARAMS } },
    async (request) => {
      const mechanism = await findMechanism(pool, request.params.id);
      if (!mechanism) throw notFound('Механизм не найден');

      const { rows: authors } = await pool.query<{ author_name: string | null }>(
        'SELECT name AS author_name FROM users WHERE id = $1',
        [mechanism.created_by],
      );

      const { rows: participants } = await pool.query(
        `SELECT p.id, p.object_id, p.role_code, p.note, p.sort_order,
                r.title AS role_title, r.direction,
                o.slug, o.name, o.full_name, o.type_code, o.status AS object_status
           FROM mechanism_participants p
           JOIN participant_roles r ON r.code = p.role_code
           JOIN objects o ON o.id = p.object_id
          WHERE p.mechanism_id = $1
          ORDER BY p.sort_order, o.name`,
        [request.params.id],
      );

      return {
        mechanism: { ...mechanism, author_name: authors[0]?.author_name ?? null },
        participants,
      };
    },
  );

  app.post<{ Body: MechanismInput }>(
    '/api/mechanisms',
    {
      onRequest: [editor],
      schema: {
        body: {
          type: 'object',
          required: ['title', 'category_code'],
          properties: MECHANISM_BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const row = await withTransaction((client) =>
        insertMechanism(client, request.body, request.currentUser!.id),
      );
      return reply.code(201).send(row);
    },
  );

  app.patch<{ Params: { id: string }; Body: MechanismPatch & { version: number } }>(
    '/api/mechanisms/:id',
    {
      onRequest: [editor],
      schema: {
        params: ID_PARAMS,
        body: {
          type: 'object',
          required: ['version'],
          properties: {
            ...MECHANISM_BODY_PROPERTIES,
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { version, ...patch } = request.body;
      if (!Object.keys(patch).length) throw badRequest('Нечего менять');

      return withTransaction((client) =>
        updateMechanism(client, request.params.id, version, patch, request.currentUser!.id),
      );
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { version: number } }>(
    '/api/mechanisms/:id',
    {
      onRequest: [editor],
      schema: {
        params: ID_PARAMS,
        querystring: {
          type: 'object',
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) =>
      withTransaction((client) =>
        softDeleteMechanism(
          client,
          request.params.id,
          request.query.version,
          request.currentUser!.id,
        ),
      ),
  );

  app.put<{
    Params: { id: string };
    Body: { version: number; participants: ParticipantInput[] };
  }>(
    '/api/mechanisms/:id/participants',
    {
      onRequest: [editor],
      schema: {
        params: ID_PARAMS,
        body: {
          type: 'object',
          required: ['version', 'participants'],
          properties: {
            version: { type: 'integer', minimum: 1 },
            participants: {
              type: 'array',
              maxItems: 200,
              items: {
                type: 'object',
                required: ['object_id', 'role_code'],
                properties: {
                  object_id: { type: 'string', format: 'uuid' },
                  role_code: { type: 'string', minLength: 1, maxLength: 100 },
                  note: { type: ['string', 'null'] },
                  sort_order: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { version, participants } = request.body;

      const seen = new Set<string>();
      for (const participant of participants) {
        const key = `${participant.object_id} ${participant.role_code}`;
        if (seen.has(key)) {
          throw badRequest('Один и тот же объект дважды в одной роли', { duplicate: key });
        }
        seen.add(key);
      }

      return withTransaction(async (client) => {
        const result = await replaceParticipants(
          client,
          request.params.id,
          version,
          participants,
          request.currentUser!.id,
        );
        return { mechanism: result.mechanism, participants: await listParticipants(client, request.params.id) };
      });
    },
  );
}
