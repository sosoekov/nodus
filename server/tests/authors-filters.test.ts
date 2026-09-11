import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { type Api, api, createMechanism, createObject } from './api-helpers';
import { createUser, login, loginAs, makeApp, resetDatabase } from './helpers';

let app: FastifyInstance;
let anna: Api;
let boris: Api;
let viewer: Api;
let annaId: string;
let borisId: string;

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
  annaId = first.id;
  borisId = second.id;
  anna = api(app, await login(app, first.email, first.password));
  boris = api(app, await login(app, second.email, second.password));
  viewer = api(app, await loginAs(app, 'viewer'));
});

/** Сдвигает дату создания объекта назад — иначе все записи одного дня. */
async function backdate(table: string, id: string, days: number): Promise<void> {
  await pool.query(
    `UPDATE ${table} SET created_at = now() - ($2 || ' days')::interval WHERE id = $1`,
    [id, days],
  );
}

describe('автор в выдаче', () => {
  it('список объектов отдает имя автора', async () => {
    await createObject(anna);

    const body = (await viewer.get('/api/objects')).body as {
      items: Array<{ author_name: string; created_by: string; created_at: string }>;
    };

    expect(body.items[0]).toMatchObject({ author_name: 'anna', created_by: annaId });
    expect(body.items[0].created_at).toBeTruthy();
  });

  it('карточка объекта отдает имя автора', async () => {
    const object = await createObject(anna);

    const card = (await viewer.get(`/api/objects/${object.id}`)).body as {
      object: { author_name: string; updated_at: string };
    };

    expect(card.object.author_name).toBe('anna');
    expect(card.object.updated_at).toBeTruthy();
  });

  it('список и карточка механизма отдают имя автора', async () => {
    const mechanism = await createMechanism(boris);

    const list = (await viewer.get('/api/mechanisms')).body as {
      items: Array<{ author_name: string }>;
    };
    expect(list.items[0].author_name).toBe('boris');

    const card = (await viewer.get(`/api/mechanisms/${mechanism.id}`)).body as {
      mechanism: { author_name: string };
    };
    expect(card.mechanism.author_name).toBe('boris');
  });

  it('автор остается прежним, когда правит другой человек', async () => {
    const object = await createObject(anna);
    await boris.patch(`/api/objects/${object.id}`, { version: 1, name: 'Правка Бориса' });

    const card = (await viewer.get(`/api/objects/${object.id}`)).body as {
      object: { author_name: string; updated_by: string };
    };

    // Автор — кто завел, а не кто трогал последним.
    expect(card.object.author_name).toBe('anna');
    expect(card.object.updated_by).toBe(borisId);
  });
});

describe('список авторов', () => {
  it('отдает только тех, кто реально что-то завел', async () => {
    await createObject(anna, { full_name: 'Константа.Раз' });
    await createObject(anna, { full_name: 'Константа.Два' });
    await createMechanism(boris);

    const body = (await viewer.get('/api/authors')).body as {
      items: Array<{ id: string; name: string; object_count: number; mechanism_count: number }>;
    };

    const names = body.items.map((item) => item.name);
    expect(names).toEqual(['anna', 'boris']);
    // viewer ничего не заводил — в фильтре ему делать нечего.
    expect(names).not.toContain('viewer');

    expect(body.items.find((item) => item.name === 'anna')).toMatchObject({
      object_count: 2,
      mechanism_count: 0,
    });
    expect(body.items.find((item) => item.name === 'boris')).toMatchObject({
      object_count: 0,
      mechanism_count: 1,
    });
  });

  it('не считает мягко удаленное', async () => {
    const object = await createObject(anna);
    await anna.del(`/api/objects/${object.id}?version=1`);

    const body = (await viewer.get('/api/authors')).body as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });
});

describe('фильтр по автору', () => {
  it('отбирает объекты одного автора', async () => {
    await createObject(anna, { full_name: 'Константа.Аннина' });
    await createObject(boris, { full_name: 'Константа.Борисова' });

    const body = (await viewer.get(`/api/objects?authorId=${annaId}`)).body as {
      items: Array<{ full_name: string }>;
      total: number;
    };

    expect(body.total).toBe(1);
    expect(body.items[0].full_name).toBe('Константа.Аннина');
  });

  it('работает для механизмов', async () => {
    await createMechanism(anna, { title: 'Аннин' });
    await createMechanism(boris, { title: 'Борисов' });

    const body = (await viewer.get(`/api/mechanisms?authorId=${borisId}`)).body as {
      items: Array<{ title: string }>;
    };

    expect(body.items.map((item) => item.title)).toEqual(['Борисов']);
  });

  it('отклоняет некорректный uuid', async () => {
    expect((await viewer.get('/api/objects?authorId=не-uuid')).status).toBe(400);
  });
});

describe('фильтр по диапазону дат', () => {
  it('отбирает по нижней границе', async () => {
    const old = await createObject(anna, { full_name: 'Константа.Старая' });
    await createObject(anna, { full_name: 'Константа.Новая' });
    await backdate('objects', old.id as string, 30);

    const today = new Date().toISOString().slice(0, 10);
    const body = (await viewer.get(`/api/objects?createdFrom=${today}`)).body as {
      items: Array<{ full_name: string }>;
    };

    expect(body.items.map((item) => item.full_name)).toEqual(['Константа.Новая']);
  });

  it('верхняя граница включает весь указанный день', async () => {
    const object = await createObject(anna);
    const today = new Date().toISOString().slice(0, 10);

    // Запись создана сегодня; фильтр «по сегодня» обязан ее показать, иначе
    // пользователь, выбравший сегодняшнюю дату, получит пустой экран.
    const body = (await viewer.get(`/api/objects?createdTo=${today}`)).body as {
      items: Array<{ id: string }>;
    };

    expect(body.items.map((item) => item.id)).toEqual([object.id]);
  });

  it('отбирает по обеим границам сразу', async () => {
    const first = await createObject(anna, { full_name: 'Константа.Давняя' });
    const second = await createObject(anna, { full_name: 'Константа.Недельной' });
    await createObject(anna, { full_name: 'Константа.Сегодняшняя' });

    await backdate('objects', first.id as string, 60);
    await backdate('objects', second.id as string, 7);

    const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10);

    const body = (await viewer.get(`/api/objects?createdFrom=${from}&createdTo=${to}`)).body as {
      items: Array<{ full_name: string }>;
    };

    expect(body.items.map((item) => item.full_name)).toEqual(['Константа.Недельной']);
  });

  it('отклоняет дату не в формате YYYY-MM-DD', async () => {
    expect((await viewer.get('/api/objects?createdFrom=12.03.2026')).status).toBe(400);
  });
});

describe('фильтры вместе', () => {
  it('автор, дата, тип и поиск сужают выдачу совместно', async () => {
    const target = await createObject(anna, {
      type_code: 'Документ',
      name: 'Заявка на подбор',
      full_name: 'Документ.ЗаявкаНаПодбор',
      tags: ['подбор'],
    });
    // Тот же тип и тег, но другой автор.
    await createObject(boris, {
      type_code: 'Документ',
      name: 'Заявка на отпуск',
      full_name: 'Документ.ЗаявкаНаОтпуск',
      tags: ['подбор'],
    });
    // Тот же автор, но другой тип.
    await createObject(anna, { type_code: 'Константа', full_name: 'Константа.Норма' });

    const today = new Date().toISOString().slice(0, 10);
    const url = `/api/objects?authorId=${annaId}&type=Документ&tags=подбор&createdFrom=${today}&q=${encodeURIComponent('Заявка')}`;

    const body = (await viewer.get(url)).body as {
      items: Array<{ id: string }>;
      total: number;
    };

    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(target.id);
  });

  it('tags отбирает по любому из перечисленных', async () => {
    await createObject(anna, { full_name: 'Константа.Раз', tags: ['подбор'] });
    await createObject(anna, { full_name: 'Константа.Два', tags: ['нормативы'] });
    await createObject(anna, { full_name: 'Константа.Три', tags: ['прочее'] });

    const body = (await viewer.get('/api/objects?tags=подбор,нормативы')).body as {
      total: number;
    };

    expect(body.total).toBe(2);
  });

  it('пустой результат не ломает пагинацию', async () => {
    await createObject(anna);

    const body = (await viewer.get(`/api/objects?authorId=${borisId}`)).body as {
      items: unknown[];
      total: number;
    };

    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});
