import type { PoolClient } from 'pg';
import { OBJECT_COLUMNS } from '../columns';
import type { Db } from '../db';
import { conflict, notFound } from '../errors';
import { slugify } from '../slug';
import { recordChange } from './changes';

export interface ObjectRow {
  id: string;
  slug: string;
  type_code: string;
  name: string;
  full_name: string | null;
  parent_id: string | null;
  subsystem: string | null;
  tags: string[];
  description: string | null;
  status: string;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export interface ObjectInput {
  type_code: string;
  name: string;
  full_name?: string | null;
  parent_id?: string | null;
  subsystem?: string | null;
  tags?: string[];
  description?: string | null;
  status?: string;
}

/** Поля, которые разрешено менять через PATCH. Слаг сюда не входит намеренно. */
export const OBJECT_PATCH_FIELDS = [
  'type_code',
  'name',
  'full_name',
  'parent_id',
  'subsystem',
  'tags',
  'description',
  'status',
] as const;

export type ObjectPatch = Partial<Pick<ObjectInput, (typeof OBJECT_PATCH_FIELDS)[number]>>;

/**
 * Слаг генерируется из full_name один раз при создании и дальше не меняется:
 * переименование объекта не должно ломать уже разосланные ссылки.
 */
export async function uniqueSlug(client: PoolClient, source: string): Promise<string> {
  const base = slugify(source);
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { rowCount } = await client.query('SELECT 1 FROM objects WHERE slug = $1', [candidate]);
    if (!rowCount) return candidate;
  }
}

export async function insertObject(
  client: PoolClient,
  input: ObjectInput,
  userId: string,
): Promise<ObjectRow> {
  const slug = await uniqueSlug(client, input.full_name || input.name);

  const { rows } = await client.query<ObjectRow>(
    `INSERT INTO objects
       (slug, type_code, name, full_name, parent_id, subsystem, tags, description, status,
        created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     RETURNING ${OBJECT_COLUMNS}`,
    [
      slug,
      input.type_code,
      input.name,
      input.full_name ?? null,
      input.parent_id ?? null,
      input.subsystem ?? null,
      input.tags ?? [],
      input.description ?? null,
      input.status ?? 'stub',
      userId,
    ],
  );

  const row = rows[0];
  await recordChange(client, 'object', row.id, 'create', row, userId);
  return row;
}

export async function findObject(db: Db, id: string): Promise<ObjectRow | null> {
  const { rows } = await db.query<ObjectRow>(
    `SELECT ${OBJECT_COLUMNS} FROM objects WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Инвариант 3: правка идет только через сверку версии. Ноль затронутых строк —
 * либо запись успели поменять, либо удалить; в первом случае отдаем 409 с
 * текущим состоянием, во втором 404.
 */
export async function updateObject(
  client: PoolClient,
  id: string,
  version: number,
  patch: ObjectPatch,
  userId: string,
): Promise<ObjectRow> {
  const entries = OBJECT_PATCH_FIELDS.filter((field) => field in patch).map(
    (field) => [field, patch[field]] as const,
  );

  const assignments = entries.map(([field], index) => `${field} = $${index + 4}`);
  const values = entries.map(([, value]) => value);

  const { rows } = await client.query<ObjectRow>(
    `UPDATE objects
        SET ${[...assignments, 'version = version + 1', 'updated_by = $3', 'updated_at = now()'].join(', ')}
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING ${OBJECT_COLUMNS}`,
    [id, version, userId, ...values],
  );

  const row = rows[0];
  if (!row) throw await staleObject(client, id);

  await recordChange(client, 'object', row.id, 'update', row, userId);
  return row;
}

export async function softDeleteObject(
  client: PoolClient,
  id: string,
  version: number,
  userId: string,
): Promise<ObjectRow> {
  const { rows } = await client.query<ObjectRow>(
    `UPDATE objects
        SET deleted_at = now(), version = version + 1, updated_by = $3, updated_at = now()
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
      RETURNING ${OBJECT_COLUMNS}`,
    [id, version, userId],
  );

  const row = rows[0];
  if (!row) throw await staleObject(client, id);

  await recordChange(client, 'object', row.id, 'delete', row, userId);
  return row;
}

async function staleObject(client: PoolClient, id: string): Promise<Error> {
  const current = await findObject(client, id);
  if (!current) return notFound('Объект не найден или уже удален');
  return conflict('Объект изменен другим пользователем', { current });
}
