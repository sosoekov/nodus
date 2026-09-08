import type { FastifyInstance } from 'fastify';
import { OBJECT_COLUMNS } from '../columns';
import { pool, withTransaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import {
  findObject,
  insertObject,
  type ObjectInput,
  type ObjectPatch,
  type ObjectRow,
  softDeleteObject,
  updateObject,
} from '../repo/objects';

const OBJECT_BODY_PROPERTIES = {
  type_code: { type: 'string', minLength: 1, maxLength: 100 },
  name: { type: 'string', minLength: 1, maxLength: 300 },
  full_name: { type: ['string', 'null'], maxLength: 500 },
  parent_id: { type: ['string', 'null'], format: 'uuid' },
  subsystem: { type: ['string', 'null'], maxLength: 200 },
  tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
  description: { type: ['string', 'null'] },
  status: { type: 'string', enum: ['stub', 'active', 'deprecated'] },
} as const;

const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

interface ListQuery {
  q?: string;
  type?: string;
  status?: string;
  subsystem?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

/** Объект нельзя спрятать, пока на него кто-то ссылается: иначе в графе останутся висячие ребра. */
async function assertDeletable(id: string): Promise<void> {
  const { rows: mechanisms } = await pool.query<{ id: string; title: string }>(
    `SELECT DISTINCT m.id, m.title
       FROM mechanism_participants p
       JOIN mechanisms m ON m.id = p.mechanism_id AND m.deleted_at IS NULL
      WHERE p.object_id = $1
      ORDER BY m.title`,
    [id],
  );
  if (mechanisms.length) {
    throw conflict('Объект участвует в механизмах — сначала уберите его из состава', {
      mechanisms,
    });
  }

  const { rows: children } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM objects WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name',
    [id],
  );
  if (children.length) {
    throw conflict('У объекта есть реквизиты — сначала удалите их', { children });
  }
}

export async function objectRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');
  const editor = app.requireRole('editor');

  app.get<{ Querystring: ListQuery }>(
    '/api/objects',
    {
      onRequest: [viewer],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 300 },
            type: { type: 'string', maxLength: 100 },
            status: { type: 'string', enum: ['stub', 'active', 'deprecated'] },
            subsystem: { type: 'string', maxLength: 200 },
            tag: { type: 'string', maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request) => {
      const { q, type, status, subsystem, tag, limit = 50, offset = 0 } = request.query;
      const conditions = ['deleted_at IS NULL'];
      const values: unknown[] = [];

      const bind = (value: unknown) => `$${values.push(value)}`;

      if (type) conditions.push(`type_code = ${bind(type)}`);
      if (status) conditions.push(`status = ${bind(status)}`);
      if (subsystem) conditions.push(`subsystem = ${bind(subsystem)}`);
      if (tag) conditions.push(`tags @> ARRAY[${bind(tag)}]::text[]`);

      // Полнотекстовый поиск ловит слова целиком, ILIKE по триграммному индексу —
      // куски имен вроде «НормыДней». Нужны оба.
      const trimmed = q?.trim();
      let rank = '';
      if (trimmed) {
        const queryParam = bind(trimmed);
        const likeParam = bind(`%${trimmed}%`);
        conditions.push(
          `(search_vector @@ websearch_to_tsquery('russian', ${queryParam})
            OR name ILIKE ${likeParam} OR full_name ILIKE ${likeParam})`,
        );
        rank = `ts_rank(search_vector, websearch_to_tsquery('russian', ${queryParam})) DESC,`;
      }

      const { rows } = await pool.query<ObjectRow>(
        `SELECT ${OBJECT_COLUMNS} FROM objects
          WHERE ${conditions.join(' AND ')}
          ORDER BY ${rank} name
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      );

      const { rows: counted } = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM objects WHERE ${conditions.join(' AND ')}`,
        values,
      );

      return { items: rows, total: counted[0].total, limit, offset };
    },
  );

  app.get<{ Querystring: { name: string; limit?: number } }>(
    '/api/objects/similar',
    {
      onRequest: [viewer],
      schema: {
        querystring: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 500 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (request) => {
      const { name, limit = 10 } = request.query;
      const { rows } = await pool.query(
        `SELECT id, slug, type_code, name, full_name, status,
                GREATEST(similarity(name, $1), similarity(coalesce(full_name, ''), $1)) AS score
           FROM objects
          WHERE deleted_at IS NULL AND (name % $1 OR full_name % $1)
          ORDER BY score DESC, name
          LIMIT $2`,
        [name.trim(), limit],
      );
      return { items: rows };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/objects/:id',
    { onRequest: [viewer], schema: { params: ID_PARAMS } },
    async (request) => {
      const object = await findObject(pool, request.params.id);
      if (!object) throw notFound('Объект не найден');

      const [parent, children, participations] = await Promise.all([
        object.parent_id ? findObject(pool, object.parent_id) : Promise.resolve(null),
        pool
          .query<ObjectRow>(
            `SELECT ${OBJECT_COLUMNS} FROM objects
              WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name`,
            [object.id],
          )
          .then((result) => result.rows),
        pool
          .query(
            `SELECT p.role_code, r.title AS role_title, r.direction, r.sort_order AS role_sort,
                    p.note, p.sort_order,
                    m.id AS mechanism_id, m.title, m.category_code, m.summary, m.status
               FROM mechanism_participants p
               JOIN mechanisms m ON m.id = p.mechanism_id AND m.deleted_at IS NULL
               JOIN participant_roles r ON r.code = p.role_code
              WHERE p.object_id = $1
              ORDER BY r.sort_order, p.sort_order, m.title`,
            [object.id],
          )
          .then((result) => result.rows),
      ]);

      // Карточка показывает механизмы сгруппированными по ролям — группируем здесь,
      // чтобы порядок ролей задавался справочником, а не фронтендом.
      const groups = new Map<string, Record<string, unknown>>();
      for (const row of participations) {
        let group = groups.get(row.role_code);
        if (!group) {
          group = {
            role_code: row.role_code,
            role_title: row.role_title,
            direction: row.direction,
            mechanisms: [],
          };
          groups.set(row.role_code, group);
        }
        (group.mechanisms as unknown[]).push({
          id: row.mechanism_id,
          title: row.title,
          category_code: row.category_code,
          summary: row.summary,
          status: row.status,
          note: row.note,
          sort_order: row.sort_order,
        });
      }

      return { object, parent, children, mechanisms_by_role: [...groups.values()] };
    },
  );

  app.post<{ Body: ObjectInput }>(
    '/api/objects',
    {
      onRequest: [editor],
      schema: {
        body: {
          type: 'object',
          required: ['type_code', 'name'],
          properties: OBJECT_BODY_PROPERTIES,
        },
      },
    },
    async (request, reply) => {
      const row = await withTransaction((client) =>
        insertObject(client, request.body, request.currentUser!.id),
      );
      return reply.code(201).send(row);
    },
  );

  app.post<{ Body: { items: ObjectInput[] } }>(
    '/api/objects/bulk',
    {
      onRequest: [editor],
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['type_code', 'name'],
                properties: OBJECT_BODY_PROPERTIES,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.currentUser!.id;

      const result = await withTransaction(async (client) => {
        const created: ObjectRow[] = [];
        const skipped: Array<{ full_name: string | null; name: string; reason: string }> = [];

        for (const item of request.body.items) {
          if (item.full_name) {
            const { rowCount } = await client.query(
              'SELECT 1 FROM objects WHERE full_name = $1 AND deleted_at IS NULL',
              [item.full_name],
            );
            if (rowCount) {
              skipped.push({
                full_name: item.full_name,
                name: item.name,
                reason: 'already_exists',
              });
              continue;
            }
          }
          created.push(await insertObject(client, item, userId));
        }

        return { created, skipped };
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{ Params: { id: string }; Body: ObjectPatch & { version: number } }>(
    '/api/objects/:id',
    {
      onRequest: [editor],
      schema: {
        params: ID_PARAMS,
        body: {
          type: 'object',
          required: ['version'],
          properties: {
            ...OBJECT_BODY_PROPERTIES,
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { version, ...patch } = request.body;
      if (!Object.keys(patch).length) throw badRequest('Нечего менять');

      return withTransaction((client) =>
        updateObject(client, request.params.id, version, patch, request.currentUser!.id),
      );
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { version: number } }>(
    '/api/objects/:id',
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
    async (request) => {
      await assertDeletable(request.params.id);
      return withTransaction((client) =>
        softDeleteObject(client, request.params.id, request.query.version, request.currentUser!.id),
      );
    },
  );
}
