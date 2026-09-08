import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { pool, withTransaction } from '../src/db';
import { seedDictionaries } from '../src/seed/dictionaries';
import type { Role } from '../src/types';

export async function resetDatabase(): Promise<void> {
  await pool.query(`
    TRUNCATE changes, edit_locks, layout, mechanism_participants, mechanisms, objects, users
    RESTART IDENTITY CASCADE
  `);
  await withTransaction(seedDictionaries);
}

export async function createUser(
  role: Role,
  email = `${role}@test.local`,
  password = 'secret',
): Promise<{ id: string; email: string; password: string; role: Role }> {
  const normalized = email.toLowerCase();
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [normalized, role, await hashPassword(password), role],
  );
  return { id: rows[0].id, email: normalized, password, role };
}

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Логинится и возвращает заголовок cookie для последующих запросов. */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as string];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export async function loginAs(app: FastifyInstance, role: Role): Promise<string> {
  const user = await createUser(role);
  return login(app, user.email, user.password);
}
