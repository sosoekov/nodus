import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { createUser, login, loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('аутентификация', () => {
  it('пускает по верному паролю и заводит сессионную cookie', async () => {
    const user = await createUser('editor');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: user.email, role: 'editor' });

    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('nodus_session=');
    expect(cookie).toContain('HttpOnly');
  });

  it('не пускает по неверному паролю', async () => {
    const user = await createUser('editor');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('не пускает несуществующего пользователя', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@test.local', password: 'secret' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('находит пользователя без учета регистра email', async () => {
    const user = await createUser('viewer', 'mixed.case@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: '  MIXED.Case@Test.Local  ', password: user.password },
    });

    expect(response.statusCode).toBe(200);
  });

  it('отдает текущего пользователя по cookie и 401 без нее', async () => {
    const cookie = await loginAs(app, 'admin');

    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anonymous.statusCode).toBe(401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({ role: 'admin' });
  });

  it('после logout cookie больше не действует', async () => {
    const cookie = await loginAs(app, 'viewer');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const cleared = String(logout.headers['set-cookie']);
    expect(cleared).toContain('nodus_session=;');
  });

  it('не принимает cookie с испорченной подписью', async () => {
    const cookie = await loginAs(app, 'viewer');
    const tampered = `${cookie.slice(0, -4)}zzzz`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: tampered },
    });

    expect(response.statusCode).toBe(401);
  });

  it('удаленный пользователь теряет доступ по старой cookie', async () => {
    const user = await createUser('editor');
    const cookie = await login(app, user.email, user.password);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('роли', () => {
  let guarded: FastifyInstance;

  beforeAll(async () => {
    guarded = await buildApp();
    guarded.get(
      '/api/test/editor-only',
      { onRequest: [guarded.requireRole('editor')] },
      async () => ({ ok: true }),
    );
    guarded.get(
      '/api/test/admin-only',
      { onRequest: [guarded.requireRole('admin')] },
      async () => ({ ok: true }),
    );
    await guarded.ready();
  });

  afterAll(async () => {
    await guarded.close();
  });

  const call = (url: string, cookie?: string) =>
    guarded.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  it('аноним получает 401', async () => {
    expect((await call('/api/test/editor-only')).statusCode).toBe(401);
  });

  it('viewer не проходит в editor-роут', async () => {
    const cookie = await loginAs(guarded, 'viewer');
    expect((await call('/api/test/editor-only', cookie)).statusCode).toBe(403);
  });

  it('editor проходит в editor-роут, но не в admin-роут', async () => {
    const cookie = await loginAs(guarded, 'editor');
    expect((await call('/api/test/editor-only', cookie)).statusCode).toBe(200);
    expect((await call('/api/test/admin-only', cookie)).statusCode).toBe(403);
  });

  it('admin проходит везде', async () => {
    const cookie = await loginAs(guarded, 'admin');
    expect((await call('/api/test/editor-only', cookie)).statusCode).toBe(200);
    expect((await call('/api/test/admin-only', cookie)).statusCode).toBe(200);
  });
});
