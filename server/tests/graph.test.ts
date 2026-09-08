import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { type Api, api, createMechanism, createObject } from './api-helpers';
import { loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;
let editor: Api;
let viewer: Api;

interface Snapshot {
  seq: number;
  objects: Array<{
    id: string;
    slug: string;
    name: string;
    type_code: string;
    status: string;
    tags: string[];
    parent_id: string | null;
    x: number | null;
    y: number | null;
  }>;
  mechanisms: Array<{ id: string; title: string; category_code: string; summary: string | null }>;
  participants: Array<{ mechanism_id: string; object_id: string; role_code: string }>;
}

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

const snapshot = async () => (await viewer.get('/api/graph/snapshot')).body as Snapshot;

describe('снапшот графа', () => {
  it('отдает объекты, механизмы, участников и текущий курсор', async () => {
    const constant = await createObject(editor, { full_name: 'Константа.Норма' });
    const document = await createObject(editor, {
      type_code: 'Документ',
      name: 'Заявка',
      full_name: 'Документ.Заявка',
    });
    const mechanism = await createMechanism(editor, { title: 'Расчет срока' });
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [
        { object_id: constant.id, role_code: 'ЗначениеПоУмолчанию' },
        { object_id: document.id, role_code: 'Приемник' },
      ],
    });

    const result = await snapshot();

    expect(result.objects).toHaveLength(2);
    expect(result.mechanisms).toHaveLength(1);
    expect(result.participants).toHaveLength(2);

    const cursor = (await viewer.get('/api/changes?since=0')).body as { latest_seq: number };
    expect(result.seq).toBe(cursor.latest_seq);
  });

  it('не тащит description и body: на 1000+ объектов ответ раздулся бы', async () => {
    await createObject(editor, { description: 'очень длинное описание' });
    await createMechanism(editor, { body: 'очень длинное тело механизма' });

    const result = await snapshot();

    expect(result.objects[0]).not.toHaveProperty('description');
    expect(result.mechanisms[0]).not.toHaveProperty('body');
    // summary нужен для всплывающей подсказки на ховере — он остается.
    expect(result.mechanisms[0]).toHaveProperty('summary');
  });

  it('отдает координаты раскладки, пока их нет — null', async () => {
    const object = await createObject(editor);

    let result = await snapshot();
    expect(result.objects[0].x).toBeNull();

    await pool.query('INSERT INTO layout (object_id, x, y) VALUES ($1, 12.5, -3.25)', [object.id]);

    result = await snapshot();
    expect(result.objects[0]).toMatchObject({ x: 12.5, y: -3.25 });
  });

  it('прячет мягко удаленные объекты и механизмы', async () => {
    const kept = await createObject(editor, { full_name: 'Константа.Живая' });
    const removed = await createObject(editor, { full_name: 'Константа.Удаленная' });
    const mechanism = await createMechanism(editor);

    await editor.del(`/api/objects/${removed.id}?version=1`);
    await editor.del(`/api/mechanisms/${mechanism.id}?version=1`);

    const result = await snapshot();

    expect(result.objects.map((item) => item.id)).toEqual([kept.id]);
    expect(result.mechanisms).toHaveLength(0);
  });

  it('не оставляет участников удаленного механизма', async () => {
    const object = await createObject(editor);
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    expect((await snapshot()).participants).toHaveLength(1);

    await editor.del(`/api/mechanisms/${mechanism.id}?version=2`);

    // Иначе в графе осталось бы ребро к узлу, которого нет в выдаче.
    expect((await snapshot()).participants).toHaveLength(0);
  });

  it('отдает parent_id, чтобы реквизиты можно было свернуть в родителя', async () => {
    const parent = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.А' });
    await createObject(editor, {
      type_code: 'Реквизит',
      name: 'СрокПодбора',
      parent_id: parent.id,
    });

    const result = await snapshot();
    const child = result.objects.find((item) => item.name === 'СрокПодбора');

    expect(child?.parent_id).toBe(parent.id);
  });

  it('курсор снапшота годится как отправная точка для догонки', async () => {
    await createObject(editor, { full_name: 'Константа.Раз' });
    const before = await snapshot();

    const added = await createObject(editor, { full_name: 'Константа.Два' });

    const caught = (await viewer.get(`/api/changes?since=${before.seq}`)).body as {
      changes: Array<{ entity_id: string }>;
    };

    expect(caught.changes.map((change) => change.entity_id)).toEqual([added.id]);
  });

  it('аноним снапшот не получает', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/graph/snapshot' });
    expect(response.statusCode).toBe(401);
  });
});
