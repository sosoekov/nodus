import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { pool } from '../src/db';
import { type Api, api, createObject } from './api-helpers';
import { createUser, login, loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;
let anna: Api;
let boris: Api;
let objectId: string;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();

  const first = await createUser('editor', 'anna@test.local');
  const second = await createUser('editor', 'boris@test.local');
  anna = api(app, await login(app, first.email, first.password));
  boris = api(app, await login(app, second.email, second.password));

  objectId = (await createObject(anna)).id as string;
});

/** Отматывает heartbeat назад, чтобы не ждать реальные 60 секунд. */
async function ageLock(seconds: number): Promise<void> {
  await pool.query(
    `UPDATE edit_locks SET heartbeat_at = now() - ($1 || ' seconds')::interval`,
    [seconds],
  );
}

describe('мягкие блокировки', () => {
  it('первый забирает блокировку', async () => {
    const response = await anna.post(`/api/locks/object/${objectId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      lock: { entity_type: 'object', entity_id: objectId, user_name: 'anna' },
    });
  });

  it('второму отвечает 409 и рассказывает, кто держит', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const response = await boris.post(`/api/locks/object/${objectId}`);

    expect(response.status).toBe(409);
    const holder = (response.body as { details: { lock: { user_id: string; age_seconds: number } } })
      .details.lock;
    expect(holder.age_seconds).toBeLessThan(5);
  });

  it('повторный захват своей же блокировки проходит и не сбрасывает acquired_at', async () => {
    const first = (await anna.post(`/api/locks/object/${objectId}`)).body as {
      lock: { acquired_at: string };
    };

    const second = (await anna.post(`/api/locks/object/${objectId}`)).body as {
      lock: { acquired_at: string };
    };

    expect(second.lock.acquired_at).toBe(first.lock.acquired_at);
  });

  it('force перебивает чужую свежую блокировку', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const response = await boris.post(`/api/locks/object/${objectId}`, { force: true });

    expect(response.status).toBe(200);
    expect((response.body as { lock: { user_name: string } }).lock.user_name).toBe('boris');
  });

  it('протухшая блокировка достается следующему без force', async () => {
    await anna.post(`/api/locks/object/${objectId}`);
    await ageLock(config.lockTtlSeconds + 5);

    const response = await boris.post(`/api/locks/object/${objectId}`);
    expect(response.status).toBe(200);
  });

  it('свежая блокировка не отдается: 59 секунд — еще не протухла', async () => {
    await anna.post(`/api/locks/object/${objectId}`);
    await ageLock(config.lockTtlSeconds - 1);

    const response = await boris.post(`/api/locks/object/${objectId}`);
    expect(response.status).toBe(409);
  });

  it('heartbeat продлевает блокировку', async () => {
    await anna.post(`/api/locks/object/${objectId}`);
    await ageLock(config.lockTtlSeconds - 5);

    const beat = await anna.post(`/api/locks/object/${objectId}/beat`);
    expect(beat.status).toBe(200);
    expect((beat.body as { lock: { age_seconds: number } }).lock.age_seconds).toBeLessThan(5);

    // После продления чужой захват снова отбивается.
    expect((await boris.post(`/api/locks/object/${objectId}`)).status).toBe(409);
  });

  it('heartbeat после перехвата сообщает, что блокировка уже не наша', async () => {
    await anna.post(`/api/locks/object/${objectId}`);
    await boris.post(`/api/locks/object/${objectId}`, { force: true });

    const beat = await anna.post(`/api/locks/object/${objectId}/beat`);

    expect(beat.status).toBe(409);
    expect(beat.body).toMatchObject({ details: { lock: { user_name: 'boris' } } });
  });

  it('heartbeat без блокировки отдает 404', async () => {
    const beat = await anna.post(`/api/locks/object/${objectId}/beat`);
    expect(beat.status).toBe(404);
  });

  it('владелец снимает блокировку, и она сразу свободна', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const released = await anna.del(`/api/locks/object/${objectId}`);
    expect(released.body).toMatchObject({ released: true });

    expect((await boris.post(`/api/locks/object/${objectId}`)).status).toBe(200);
  });

  it('чужую блокировку снять нельзя', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const response = await boris.del(`/api/locks/object/${objectId}`);

    expect(response.body).toMatchObject({ released: false });
    expect((await boris.post(`/api/locks/object/${objectId}`)).status).toBe(409);
  });

  it('блокировки объекта и механизма не мешают друг другу', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const response = await boris.post(`/api/locks/mechanism/${objectId}`);
    expect(response.status).toBe(200);
  });

  it('блокировка не запрещает править: это предупреждение, а не запрет', async () => {
    await anna.post(`/api/locks/object/${objectId}`);

    const response = await boris.patch(`/api/objects/${objectId}`, {
      version: 1,
      name: 'Правка в обход баннера',
    });

    expect(response.status).toBe(200);
  });

  it('viewer не берет блокировки', async () => {
    const viewer = api(app, await loginAs(app, 'viewer'));
    expect((await viewer.post(`/api/locks/object/${objectId}`)).status).toBe(403);
  });

  it('неизвестный тип сущности отклоняется', async () => {
    expect((await anna.post(`/api/locks/wrong/${objectId}`)).status).toBe(400);
  });
});
