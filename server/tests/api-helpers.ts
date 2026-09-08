import type { FastifyInstance } from 'fastify';
import { pool } from '../src/db';

export interface Json {
  [key: string]: unknown;
}

export function api(app: FastifyInstance, cookie: string) {
  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const response = await app.inject({ method, url, headers: { cookie }, payload: payload as never });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };

  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload),
    put: (url: string, payload?: unknown) => call('PUT', url, payload),
    del: (url: string) => call('DELETE', url),
  };
}

export type Api = ReturnType<typeof api>;

export async function createObject(client: Api, overrides: Json = {}): Promise<Json> {
  const response = await client.post('/api/objects', {
    type_code: 'Константа',
    name: 'Тестовая константа',
    full_name: 'Константа.Тестовая',
    ...overrides,
  });
  if (response.status !== 201) {
    throw new Error(`createObject failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as Json;
}

export async function createMechanism(client: Api, overrides: Json = {}): Promise<Json> {
  const response = await client.post('/api/mechanisms', {
    title: 'Тестовый механизм',
    category_code: 'Расчет',
    ...overrides,
  });
  if (response.status !== 201) {
    throw new Error(`createMechanism failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as Json;
}

export async function changesFor(
  entityType: string,
  entityId: string,
): Promise<Array<{ op: string; payload: Json }>> {
  const { rows } = await pool.query(
    'SELECT op, payload FROM changes WHERE entity_type = $1 AND entity_id = $2 ORDER BY seq',
    [entityType, entityId],
  );
  return rows;
}

export async function countChanges(): Promise<number> {
  const { rows } = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM changes');
  return rows[0].total;
}
