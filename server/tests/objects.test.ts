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

describe('создание объектов', () => {
  it('создаёт объект со статусом stub и версией 1', async () => {
    const response = await editor.post('/api/objects', {
      type_code: 'Документ',
      name: 'Заявка на подбор',
      full_name: 'Документ.ЗаявкаНаПодбор',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      type_code: 'Документ',
      status: 'stub',
      version: 1,
      slug: 'dokument-zayavka-na-podbor',
      deleted_at: null,
    });
  });

  it('разводит слаги при совпадении полных имён', async () => {
    const first = await createObject(editor, { full_name: 'Константа.Норма' });
    const second = await createObject(editor, { full_name: 'Константа.Норма' });

    expect(first.slug).toBe('konstanta-norma');
    expect(second.slug).toBe('konstanta-norma-2');
  });

  it('пишет в журнал ровно одну строку create', async () => {
    const object = await createObject(editor);
    const entries = await changesFor('object', object.id as string);

    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('create');
    expect(entries[0].payload).toMatchObject({ id: object.id, version: 1 });
  });

  it('viewer не может создавать', async () => {
    const response = await viewer.post('/api/objects', {
      type_code: 'Константа',
      name: 'Нельзя',
    });
    expect(response.status).toBe(403);
  });

  it('аноним не видит список объектов', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/objects' });
    expect(response.statusCode).toBe(401);
  });

  it('на некорректный uuid в пути отвечает 400, а не падает', async () => {
    const response = await viewer.get('/api/objects/не-uuid');
    expect(response.status).toBe(400);
  });

  it('отклоняет неизвестный тип и не оставляет следов в журнале', async () => {
    const before = await countChanges();

    const response = await editor.post('/api/objects', {
      type_code: 'ТакогоТипаНет',
      name: 'Объект',
    });

    expect(response.status).toBe(400);
    expect(await countChanges()).toBe(before);
  });
});

describe('инвариант двух уровней', () => {
  it('позволяет завести реквизит у объекта', async () => {
    const parent = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.А' });
    const child = await createObject(editor, {
      type_code: 'Реквизит',
      name: 'СрокПодбора',
      full_name: 'Документ.А.СрокПодбора',
      parent_id: parent.id,
    });

    expect(child.parent_id).toBe(parent.id);
  });

  it('не даёт завести реквизит реквизита', async () => {
    const parent = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.А' });
    const child = await createObject(editor, {
      type_code: 'Реквизит',
      name: 'СрокПодбора',
      parent_id: parent.id,
    });

    const response = await editor.post('/api/objects', {
      type_code: 'Реквизит',
      name: 'Ещё глубже',
      parent_id: child.id,
    });

    expect(response.status).toBe(400);
  });

  it('не даёт подчинить объект, у которого уже есть реквизиты', async () => {
    const parent = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.А' });
    await createObject(editor, { type_code: 'Реквизит', name: 'Реквизит', parent_id: parent.id });

    const other = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.Б' });

    const response = await editor.patch(`/api/objects/${parent.id}`, {
      version: parent.version,
      parent_id: other.id,
    });

    expect(response.status).toBe(400);
  });
});

describe('оптимистичная блокировка', () => {
  it('поднимает версию и пишет update в журнал', async () => {
    const object = await createObject(editor);

    const response = await editor.patch(`/api/objects/${object.id}`, {
      version: object.version,
      name: 'Новое имя',
      status: 'active',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Новое имя', status: 'active', version: 2 });

    const entries = await changesFor('object', object.id as string);
    expect(entries.map((entry) => entry.op)).toEqual(['create', 'update']);
  });

  it('на устаревшей версии отдаёт 409 с текущим состоянием', async () => {
    const object = await createObject(editor);
    await editor.patch(`/api/objects/${object.id}`, { version: 1, name: 'Первый' });

    const response = await editor.patch(`/api/objects/${object.id}`, {
      version: 1,
      name: 'Второй',
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'conflict',
      details: { current: { name: 'Первый', version: 2 } },
    });
  });

  it('конфликт не оставляет строку в журнале', async () => {
    const object = await createObject(editor);
    await editor.patch(`/api/objects/${object.id}`, { version: 1, name: 'Первый' });

    const before = await countChanges();
    await editor.patch(`/api/objects/${object.id}`, { version: 1, name: 'Второй' });

    expect(await countChanges()).toBe(before);
  });

  it('не сохраняет правку без единого поля', async () => {
    const object = await createObject(editor);
    const response = await editor.patch(`/api/objects/${object.id}`, { version: 1 });
    expect(response.status).toBe(400);
  });

  it('на несуществующем объекте отдаёт 404, а не 409', async () => {
    const response = await editor.patch(
      '/api/objects/00000000-0000-4000-8000-000000000000',
      { version: 1, name: 'Никто' },
    );
    expect(response.status).toBe(404);
  });
});

describe('мягкое удаление', () => {
  it('прячет объект, но оставляет строку в базе', async () => {
    const object = await createObject(editor);

    const response = await editor.del(`/api/objects/${object.id}?version=${object.version}`);
    expect(response.status).toBe(200);

    expect((await viewer.get(`/api/objects/${object.id}`)).status).toBe(404);
    expect((await viewer.get('/api/objects')).body).toMatchObject({ total: 0 });

    const { rows } = await pool.query('SELECT deleted_at FROM objects WHERE id = $1', [object.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('пишет в журнал delete с новым состоянием', async () => {
    const object = await createObject(editor);
    await editor.del(`/api/objects/${object.id}?version=1`);

    const entries = await changesFor('object', object.id as string);
    expect(entries.map((entry) => entry.op)).toEqual(['create', 'delete']);
    expect(entries[1].payload.deleted_at).not.toBeNull();
  });

  it('на устаревшей версии отдаёт 409', async () => {
    const object = await createObject(editor);
    await editor.patch(`/api/objects/${object.id}`, { version: 1, name: 'Изменён' });

    const response = await editor.del(`/api/objects/${object.id}?version=1`);
    expect(response.status).toBe(409);
  });

  it('повторное удаление отдаёт 404', async () => {
    const object = await createObject(editor);
    await editor.del(`/api/objects/${object.id}?version=1`);

    const response = await editor.del(`/api/objects/${object.id}?version=2`);
    expect(response.status).toBe(404);
  });

  it('не удаляет объект, который участвует в механизме', async () => {
    const object = await createObject(editor);
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: mechanism.version,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    const response = await editor.del(`/api/objects/${object.id}?version=1`);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      details: { mechanisms: [{ title: 'Тестовый механизм' }] },
    });
  });

  it('не удаляет объект с реквизитами', async () => {
    const parent = await createObject(editor, { type_code: 'Документ', full_name: 'Документ.А' });
    await createObject(editor, { type_code: 'Реквизит', name: 'Реквизит', parent_id: parent.id });

    const response = await editor.del(`/api/objects/${parent.id}?version=1`);
    expect(response.status).toBe(409);
  });
});

describe('поиск и фильтры', () => {
  beforeEach(async () => {
    await createObject(editor, {
      type_code: 'Константа',
      name: 'Норма дней поиска',
      full_name: 'Константа.НормаДнейПоиска',
      subsystem: 'ПодборПерсонала',
      tags: ['нормативы'],
      status: 'active',
    });
    await createObject(editor, {
      type_code: 'Документ',
      name: 'Заявка на подбор персонала',
      full_name: 'Документ.ЗаявкаНаПодборПерсонала',
      subsystem: 'ПодборПерсонала',
      tags: ['подбор'],
      status: 'active',
    });
    await createObject(editor, {
      type_code: 'Справочник',
      name: 'Города',
      full_name: 'Справочник.Города',
      subsystem: 'Общее',
      status: 'stub',
    });
  });

  it('фильтрует по типу, статусу, подсистеме и тегу', async () => {
    expect((await viewer.get('/api/objects?type=Документ')).body).toMatchObject({ total: 1 });
    expect((await viewer.get('/api/objects?status=stub')).body).toMatchObject({ total: 1 });
    expect((await viewer.get('/api/objects?subsystem=ПодборПерсонала')).body).toMatchObject({
      total: 2,
    });
    expect((await viewer.get('/api/objects?tag=нормативы')).body).toMatchObject({ total: 1 });
  });

  it('находит по слову через полнотекстовый поиск', async () => {
    const response = await viewer.get('/api/objects?q=заявка');
    expect(response.body).toMatchObject({ total: 1 });
  });

  it('находит по куску слитного имени', async () => {
    const response = await viewer.get('/api/objects?q=НормаДней');
    expect((response.body as { total: number }).total).toBe(1);
  });

  it('предлагает похожие имена для отлова дублей', async () => {
    const response = await viewer.get('/api/objects/similar?name=Норма дней поиcка');
    const items = (response.body as { items: Array<{ full_name: string }> }).items;

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].full_name).toBe('Константа.НормаДнейПоиска');
  });
});

describe('массовая вставка', () => {
  it('создаёт список объектов одной транзакцией', async () => {
    const response = await editor.post('/api/objects/bulk', {
      items: [
        { type_code: 'Документ', name: 'ЗаявкаНаПодбор', full_name: 'Документ.ЗаявкаНаПодбор' },
        { type_code: 'Константа', name: 'НормаДней', full_name: 'Константа.НормаДней' },
      ],
    });

    expect(response.status).toBe(201);
    expect((response.body as { created: unknown[] }).created).toHaveLength(2);
    expect((await viewer.get('/api/objects')).body).toMatchObject({ total: 2 });
  });

  it('пропускает уже существующие полные имена', async () => {
    await createObject(editor, { full_name: 'Константа.Норма', name: 'Норма' });

    const response = await editor.post('/api/objects/bulk', {
      items: [
        { type_code: 'Константа', name: 'Норма', full_name: 'Константа.Норма' },
        { type_code: 'Константа', name: 'Другая', full_name: 'Константа.Другая' },
      ],
    });

    expect((response.body as { created: unknown[] }).created).toHaveLength(1);
    expect((response.body as { skipped: unknown[] }).skipped).toEqual([
      { full_name: 'Константа.Норма', name: 'Норма', reason: 'already_exists' },
    ]);
  });

  it('откатывает всю пачку, если одна строка не прошла', async () => {
    const before = await countChanges();

    const response = await editor.post('/api/objects/bulk', {
      items: [
        { type_code: 'Константа', name: 'Хорошая', full_name: 'Константа.Хорошая' },
        { type_code: 'ТакогоТипаНет', name: 'Плохая', full_name: 'Плохая' },
      ],
    });

    expect(response.status).toBe(400);
    expect((await viewer.get('/api/objects')).body).toMatchObject({ total: 0 });
    expect(await countChanges()).toBe(before);
  });
});

describe('карточка объекта', () => {
  it('отдаёт реквизиты и механизмы, сгруппированные по ролям', async () => {
    const document = await createObject(editor, {
      type_code: 'Документ',
      name: 'Заявка',
      full_name: 'Документ.Заявка',
    });
    await createObject(editor, {
      type_code: 'Реквизит',
      name: 'СрокПодбора',
      parent_id: document.id,
    });
    const constant = await createObject(editor, {
      type_code: 'Константа',
      name: 'Норма',
      full_name: 'Константа.Норма',
    });

    const mechanism = await createMechanism(editor, { title: 'Определение срока' });
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: mechanism.version,
      participants: [
        { object_id: constant.id, role_code: 'ЗначениеПоУмолчанию' },
        { object_id: document.id, role_code: 'Приёмник', note: 'реквизит СрокПодбора' },
      ],
    });

    const card = (await viewer.get(`/api/objects/${document.id}`)).body as {
      children: unknown[];
      mechanisms_by_role: Array<{ role_code: string; direction: string; mechanisms: unknown[] }>;
    };

    expect(card.children).toHaveLength(1);
    expect(card.mechanisms_by_role).toHaveLength(1);
    expect(card.mechanisms_by_role[0]).toMatchObject({
      role_code: 'Приёмник',
      direction: 'target',
    });
    expect(card.mechanisms_by_role[0].mechanisms).toMatchObject([
      { title: 'Определение срока', note: 'реквизит СрокПодбора' },
    ]);
  });
});
