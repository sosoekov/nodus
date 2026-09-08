import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { type Api, api, createMechanism, createObject } from './api-helpers';
import { loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;
let editor: Api;
let viewer: Api;
let admin: Api;

interface Queue {
  stubs: Array<{ id: string; name: string }>;
  unlinked_objects: Array<{ id: string; name: string }>;
  mechanisms_without_body: Array<{ id: string; title: string }>;
  mechanisms_without_participants: Array<{ id: string; title: string }>;
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
  admin = api(app, await loginAs(app, 'admin'));
});

const queue = async () => (await viewer.get('/api/queue/incomplete')).body as Queue;

describe('очередь незаполненного', () => {
  it('собирает заглушки', async () => {
    await createObject(editor, { full_name: 'Константа.Заглушка' });
    await createObject(editor, { full_name: 'Константа.Живая', status: 'active' });

    const result = await queue();

    expect(result.stubs).toHaveLength(1);
    expect(result.stubs[0].name).toBe('Тестовая константа');
  });

  it('собирает объекты без связей и убирает их, когда связь появилась', async () => {
    const object = await createObject(editor, { status: 'active' });

    expect((await queue()).unlinked_objects).toHaveLength(1);

    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    expect((await queue()).unlinked_objects).toHaveLength(0);
  });

  it('считает объект несвязанным, если его единственный механизм удален', async () => {
    const object = await createObject(editor, { status: 'active' });
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    expect((await queue()).unlinked_objects).toHaveLength(0);

    await editor.del(`/api/mechanisms/${mechanism.id}?version=2`);

    expect((await queue()).unlinked_objects).toHaveLength(1);
  });

  it('собирает механизмы с пустым body, включая состоящий из пробелов', async () => {
    await createMechanism(editor, { title: 'Без тела' });
    await createMechanism(editor, { title: 'Пробелы', body: '   \n  ' });
    await createMechanism(editor, { title: 'С телом', body: 'описание' });

    const titles = (await queue()).mechanisms_without_body.map((item) => item.title);

    expect(titles).toContain('Без тела');
    expect(titles).toContain('Пробелы');
    expect(titles).not.toContain('С телом');
  });

  it('собирает механизмы без участников', async () => {
    const empty = await createMechanism(editor, { title: 'Пустой' });
    const filled = await createMechanism(editor, { title: 'С составом' });
    const object = await createObject(editor);
    await editor.put(`/api/mechanisms/${filled.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    const result = (await queue()).mechanisms_without_participants;

    expect(result.map((item) => item.id)).toEqual([empty.id]);
  });

  it('не показывает удаленное', async () => {
    const object = await createObject(editor);
    const mechanism = await createMechanism(editor);
    await editor.del(`/api/objects/${object.id}?version=1`);
    await editor.del(`/api/mechanisms/${mechanism.id}?version=1`);

    const result = await queue();

    expect(result.stubs).toHaveLength(0);
    expect(result.unlinked_objects).toHaveLength(0);
    expect(result.mechanisms_without_body).toHaveLength(0);
  });
});

describe('раскладка', () => {
  it('сохраняет координаты и отдает их в снапшоте', async () => {
    const object = await createObject(editor);

    const response = await editor.put('/api/layout', {
      positions: [{ object_id: object.id, x: 10.5, y: -20.25, pinned: true }],
    });
    expect(response.status).toBe(200);

    const snapshot = (await viewer.get('/api/graph/snapshot')).body as {
      objects: Array<{ x: number; y: number; pinned: boolean }>;
    };
    expect(snapshot.objects[0]).toMatchObject({ x: 10.5, y: -20.25, pinned: true });
  });

  it('перезаписывает координаты того же объекта', async () => {
    const object = await createObject(editor);

    await editor.put('/api/layout', { positions: [{ object_id: object.id, x: 1, y: 1 }] });
    await editor.put('/api/layout', { positions: [{ object_id: object.id, x: 2, y: 3 }] });

    const { rows } = await pool.query('SELECT x, y FROM layout WHERE object_id = $1', [object.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ x: 2, y: 3 });
  });

  it('viewer раскладку не сохраняет', async () => {
    const object = await createObject(editor);
    const response = await viewer.put('/api/layout', {
      positions: [{ object_id: object.id, x: 1, y: 1 }],
    });
    expect(response.status).toBe(403);
  });

  it('пересчет доступен только администратору', async () => {
    expect((await editor.post('/api/layout/recompute')).status).toBe(403);
    expect((await admin.post('/api/layout/recompute')).status).toBe(200);
  });

  it('пересчет расставляет все объекты и разносит их по разным точкам', async () => {
    const first = await createObject(editor, { full_name: 'Константа.Раз' });
    const second = await createObject(editor, { full_name: 'Константа.Два' });
    const third = await createObject(editor, { full_name: 'Константа.Три' });
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [
        { object_id: first.id, role_code: 'Источник' },
        { object_id: second.id, role_code: 'Приемник' },
      ],
    });

    const response = await admin.post('/api/layout/recompute');

    expect(response.body).toMatchObject({ nodes: 3, edges: 1 });

    const { rows } = await pool.query<{ object_id: string; x: number; y: number }>(
      'SELECT object_id, x, y FROM layout',
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => Number.isFinite(row.x) && Number.isFinite(row.y))).toBe(true);

    const points = new Set(rows.map((row) => `${row.x},${row.y}`));
    expect(points.size).toBe(3);
    expect(rows.map((row) => row.object_id).sort()).toEqual(
      [first.id, second.id, third.id].sort(),
    );
  });

  it('закрепленный узел пересчет не двигает', async () => {
    const pinned = await createObject(editor, { full_name: 'Константа.Закреплена' });
    const loose = await createObject(editor, { full_name: 'Константа.Свободна' });
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [
        { object_id: pinned.id, role_code: 'Источник' },
        { object_id: loose.id, role_code: 'Приемник' },
      ],
    });

    await editor.put('/api/layout', {
      positions: [{ object_id: pinned.id, x: 42, y: -42, pinned: true }],
    });

    const response = await admin.post('/api/layout/recompute');
    expect(response.body).toMatchObject({ pinned: 1 });

    const { rows } = await pool.query<{ x: number; y: number; pinned: boolean }>(
      'SELECT x, y, pinned FROM layout WHERE object_id = $1',
      [pinned.id],
    );
    expect(rows[0]).toMatchObject({ x: 42, y: -42, pinned: true });
  });

  it('пересчет на пустой базе не падает', async () => {
    const response = await admin.post('/api/layout/recompute');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ nodes: 0 });
  });
});
