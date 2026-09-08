import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { type Api, api, changesFor, countChanges, createMechanism, createObject } from './api-helpers';
import { loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;
let editor: Api;
let viewer: Api;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();
  editor = api(app, await loginAs(app, 'editor'));
  viewer = api(app, await loginAs(app, 'viewer'));
});

describe('CRUD механизмов', () => {
  it('создаёт механизм черновиком', async () => {
    const response = await editor.post('/api/mechanisms', {
      title: 'Определение нормы срока подбора',
      category_code: 'Расчёт',
      summary: 'Константа с переопределением по городу',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'draft', version: 1 });
  });

  it('не принимает summary длиннее 200 символов', async () => {
    const response = await editor.post('/api/mechanisms', {
      title: 'Длинное',
      category_code: 'Расчёт',
      summary: 'я'.repeat(201),
    });

    expect(response.status).toBe(400);
  });

  it('viewer не может создавать', async () => {
    const response = await viewer.post('/api/mechanisms', {
      title: 'Нельзя',
      category_code: 'Расчёт',
    });
    expect(response.status).toBe(403);
  });

  it('правит по версии и пишет журнал', async () => {
    const mechanism = await createMechanism(editor);

    const response = await editor.patch(`/api/mechanisms/${mechanism.id}`, {
      version: mechanism.version,
      status: 'active',
      body: '# Описание',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'active', version: 2 });

    const entries = await changesFor('mechanism', mechanism.id as string);
    expect(entries.map((entry) => entry.op)).toEqual(['create', 'update']);
  });

  it('на устаревшей версии отдаёт 409 с текущим состоянием', async () => {
    const mechanism = await createMechanism(editor);
    await editor.patch(`/api/mechanisms/${mechanism.id}`, { version: 1, title: 'Первый' });

    const response = await editor.patch(`/api/mechanisms/${mechanism.id}`, {
      version: 1,
      title: 'Второй',
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ details: { current: { title: 'Первый', version: 2 } } });
  });

  it('мягко удаляет и прячет из выдачи', async () => {
    const mechanism = await createMechanism(editor);

    expect((await editor.del(`/api/mechanisms/${mechanism.id}?version=1`)).status).toBe(200);
    expect((await viewer.get(`/api/mechanisms/${mechanism.id}`)).status).toBe(404);
    expect((await viewer.get('/api/mechanisms')).body).toMatchObject({ total: 0 });

    const { rows } = await pool.query('SELECT deleted_at FROM mechanisms WHERE id = $1', [
      mechanism.id,
    ]);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('ищет по заголовку и телу', async () => {
    await createMechanism(editor, {
      title: 'Определение нормы срока подбора',
      body: 'Значение берётся из константы',
    });
    await createMechanism(editor, { title: 'Печать заявки', category_code: 'Печать' });

    expect((await viewer.get('/api/mechanisms?q=константы')).body).toMatchObject({ total: 1 });
    expect((await viewer.get('/api/mechanisms?category=Печать')).body).toMatchObject({ total: 1 });
  });
});

describe('состав участников', () => {
  it('ставит состав, поднимает версию механизма и пишет журнал', async () => {
    const mechanism = await createMechanism(editor);
    const constant = await createObject(editor, { full_name: 'Константа.Норма' });
    const document = await createObject(editor, {
      type_code: 'Документ',
      name: 'Заявка',
      full_name: 'Документ.Заявка',
    });

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: mechanism.version,
      participants: [
        { object_id: constant.id, role_code: 'ЗначениеПоУмолчанию', note: 'база' },
        { object_id: document.id, role_code: 'Приёмник' },
      ],
    });

    expect(response.status).toBe(200);
    const body = response.body as {
      mechanism: { version: number };
      participants: Array<{ role_code: string; sort_order: number }>;
    };
    expect(body.mechanism.version).toBe(2);
    expect(body.participants).toHaveLength(2);
    expect(body.participants.map((p) => p.sort_order)).toEqual([0, 10]);

    const created = await pool.query(
      "SELECT count(*)::int AS total FROM changes WHERE entity_type = 'participant' AND op = 'create'",
    );
    expect(created.rows[0].total).toBe(2);
  });

  it('заменяет состав целиком: лишнее удаляет, новое добавляет', async () => {
    const mechanism = await createMechanism(editor);
    const first = await createObject(editor, { full_name: 'Константа.Первая' });
    const second = await createObject(editor, { full_name: 'Константа.Вторая' });

    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: first.id, role_code: 'Источник' }],
    });

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 2,
      participants: [{ object_id: second.id, role_code: 'Источник' }],
    });

    const participants = (response.body as { participants: Array<{ object_id: string }> })
      .participants;
    expect(participants).toHaveLength(1);
    expect(participants[0].object_id).toBe(second.id);

    const ops = await pool.query<{ op: string }>(
      "SELECT op FROM changes WHERE entity_type = 'participant' ORDER BY seq",
    );
    expect(ops.rows.map((row) => row.op)).toEqual(['create', 'delete', 'create']);
  });

  it('не трогает журнал для участника, который не изменился', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник', note: 'тот же' }],
    });

    const before = await countChanges();

    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 2,
      participants: [{ object_id: object.id, role_code: 'Источник', note: 'тот же' }],
    });

    // Только строка update самого механизма — состав не менялся.
    expect(await countChanges()).toBe(before + 1);
  });

  it('на устаревшей версии отдаёт 409 и не меняет состав', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [],
    });

    expect(response.status).toBe(409);

    const card = (await viewer.get(`/api/mechanisms/${mechanism.id}`)).body as {
      participants: unknown[];
    };
    expect(card.participants).toHaveLength(1);
  });

  it('отклоняет один объект дважды в одной роли', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [
        { object_id: object.id, role_code: 'Источник' },
        { object_id: object.id, role_code: 'Источник' },
      ],
    });

    expect(response.status).toBe(400);
  });

  it('разрешает один объект в двух разных ролях', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [
        { object_id: object.id, role_code: 'Источник' },
        { object_id: object.id, role_code: 'Приёмник' },
      ],
    });

    expect(response.status).toBe(200);
  });

  it('не берёт в состав мягко удалённый объект', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);
    await editor.del(`/api/objects/${object.id}?version=1`);

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    expect(response.status).toBe(400);
  });

  it('отклоняет несуществующую роль', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    const response = await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'НетТакойРоли' }],
    });

    expect(response.status).toBe(400);
  });

  it('отдаёт состав с ролями и направлением', async () => {
    const mechanism = await createMechanism(editor);
    const object = await createObject(editor);

    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Приёмник', note: 'куда пишем' }],
    });

    const card = (await viewer.get(`/api/mechanisms/${mechanism.id}`)).body as {
      participants: Array<Record<string, unknown>>;
    };

    expect(card.participants[0]).toMatchObject({
      role_code: 'Приёмник',
      role_title: 'Приёмник',
      direction: 'target',
      note: 'куда пишем',
      full_name: 'Константа.Тестовая',
    });
  });
});
