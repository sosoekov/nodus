import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { changeBus } from '../src/events/bus';
import { type Api, api, createMechanism, createObject } from './api-helpers';
import { loginAs, resetDatabase } from './helpers';
import { SseClient } from './sse-client';

let app: FastifyInstance;
let baseUrl: string;
let editorCookie: string;
let viewerCookie: string;
let editor: Api;
let viewer: Api;
const streams: SseClient[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('нет адреса сервера');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDatabase();
  editorCookie = await loginAs(app, 'editor');
  viewerCookie = await loginAs(app, 'viewer');
  editor = api(app, editorCookie);
  viewer = api(app, viewerCookie);
});

afterEach(() => {
  for (const stream of streams.splice(0)) stream.close();
});

async function connect(cookie = viewerCookie, lastEventId?: number): Promise<SseClient> {
  const stream = await SseClient.connect(baseUrl, cookie, lastEventId);
  streams.push(stream);
  await stream.waitFor((message) => message.event === 'hello');
  return stream;
}

describe('журнал изменений', () => {
  it('отдает патчи после указанного курсора', async () => {
    const first = await createObject(editor, { full_name: 'Константа.Первая' });
    const afterFirst = (await viewer.get('/api/changes?since=0')).body as {
      seq: number;
      changes: Array<{ entity_id: string }>;
    };

    expect(afterFirst.changes).toHaveLength(1);
    expect(afterFirst.changes[0].entity_id).toBe(first.id);

    const second = await createObject(editor, { full_name: 'Константа.Вторая' });

    const tail = (await viewer.get(`/api/changes?since=${afterFirst.seq}`)).body as {
      changes: Array<{ entity_id: string }>;
      has_more: boolean;
    };

    expect(tail.changes).toHaveLength(1);
    expect(tail.changes[0].entity_id).toBe(second.id);
    expect(tail.has_more).toBe(false);
  });

  it('на актуальном курсоре отдает пустой список', async () => {
    await createObject(editor);
    const head = (await viewer.get('/api/changes?since=0')).body as { seq: number };

    const response = (await viewer.get(`/api/changes?since=${head.seq}`)).body as {
      changes: unknown[];
      has_more: boolean;
    };

    expect(response.changes).toEqual([]);
    expect(response.has_more).toBe(false);
  });

  it('режет выдачу по лимиту и признается, что есть еще', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createObject(editor, { full_name: `Константа.Н${i}` });
    }

    const page = (await viewer.get('/api/changes?since=0&limit=2')).body as {
      changes: unknown[];
      seq: number;
      latest_seq: number;
      has_more: boolean;
    };

    expect(page.changes).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.latest_seq).toBe(5);

    const rest = (await viewer.get(`/api/changes?since=${page.seq}&limit=100`)).body as {
      changes: unknown[];
      has_more: boolean;
    };
    expect(rest.changes).toHaveLength(3);
    expect(rest.has_more).toBe(false);
  });

  it('патч удаления несет новое состояние с deleted_at', async () => {
    const object = await createObject(editor);
    await editor.del(`/api/objects/${object.id}?version=1`);

    const response = (await viewer.get('/api/changes?since=0')).body as {
      changes: Array<{ op: string; payload: { deleted_at: string | null } }>;
    };

    const deletion = response.changes.find((change) => change.op === 'delete');
    expect(deletion?.payload.deleted_at).not.toBeNull();
  });

  it('аноним не читает журнал', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/changes?since=0' });
    expect(response.statusCode).toBe(401);
  });
});

describe('SSE', () => {
  it('здоровается текущим курсором', async () => {
    await createObject(editor);
    const stream = await connect();

    const hello = await stream.waitFor((message) => message.event === 'hello');
    expect((hello.data as { seq: number }).seq).toBe(1);
  });

  it('доставляет патч подписчику сразу после правки', async () => {
    const stream = await connect();

    const object = await createObject(editor, { full_name: 'Константа.Живая' });

    const message = await stream.waitFor(
      (m) => m.event === 'change' && (m.data as { entity_id: string }).entity_id === object.id,
    );

    expect(message.data).toMatchObject({ entity_type: 'object', op: 'create' });
    expect(message.id).toBe(String((message.data as { seq: number }).seq));
  });

  it('доставляет патч всем подписчикам, а не только автору правки', async () => {
    const first = await connect(viewerCookie);
    const second = await connect(editorCookie);

    const object = await createObject(editor);

    for (const stream of [first, second]) {
      await stream.waitFor(
        (m) => m.event === 'change' && (m.data as { entity_id: string }).entity_id === object.id,
      );
    }
  });

  it('шлет патч на каждую правку по порядку', async () => {
    const stream = await connect();

    const object = await createObject(editor);
    await editor.patch(`/api/objects/${object.id}`, { version: 1, name: 'Второе имя' });
    await editor.del(`/api/objects/${object.id}?version=2`);

    await stream.waitFor((m) => m.event === 'change' && (m.data as { op: string }).op === 'delete');

    const ops = stream.changes().map((m) => (m.data as { op: string }).op);
    expect(ops).toEqual(['create', 'update', 'delete']);

    const seqs = stream.changes().map((m) => (m.data as { seq: number }).seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('не шлет патч, если транзакция откатилась', async () => {
    const stream = await connect();

    const before = stream.changes().length;
    const response = await editor.post('/api/objects/bulk', {
      items: [
        { type_code: 'Константа', name: 'Хорошая', full_name: 'Константа.Хорошая' },
        { type_code: 'ТакогоТипаНет', name: 'Плохая' },
      ],
    });
    expect(response.status).toBe(400);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stream.changes()).toHaveLength(before);
  });

  it('на реконнекте с Last-Event-ID досылает пропущенное', async () => {
    const first = await connect();
    const object = await createObject(editor, { full_name: 'Константа.Раз' });
    const seen = await first.waitFor((m) => m.event === 'change');
    first.close();

    // Правка, которая случилась, пока клиент был отключен.
    const missed = await createObject(editor, { full_name: 'Константа.Два' });

    const reconnected = await connect(viewerCookie, Number(seen.id));

    const replayed = await reconnected.waitFor(
      (m) => m.event === 'change' && (m.data as { entity_id: string }).entity_id === missed.id,
    );

    expect((replayed.data as { seq: number }).seq).toBeGreaterThan(Number(seen.id));
    // Уже виденный патч повторно не приходит.
    expect(
      reconnected.changes().some((m) => (m.data as { entity_id: string }).entity_id === object.id),
    ).toBe(false);
  });

  it('снимает подписку, когда клиент отключился', async () => {
    const before = changeBus.subscriberCount;

    const stream = await connect();
    expect(changeBus.subscriberCount).toBe(before + 1);

    stream.close();

    const deadline = Date.now() + 3000;
    while (changeBus.subscriberCount > before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(changeBus.subscriberCount).toBe(before);
  });

  it('аноним не подключается', async () => {
    const response = await fetch(`${baseUrl}/api/events`);
    expect(response.status).toBe(401);
    await response.body?.cancel();
  });

  it('патч механизма и состава долетает одним потоком', async () => {
    const stream = await connect();

    const object = await createObject(editor);
    const mechanism = await createMechanism(editor);
    await editor.put(`/api/mechanisms/${mechanism.id}/participants`, {
      version: 1,
      participants: [{ object_id: object.id, role_code: 'Источник' }],
    });

    await stream.waitFor(
      (m) => m.event === 'change' && (m.data as { entity_type: string }).entity_type === 'participant',
    );

    const types = stream.changes().map((m) => (m.data as { entity_type: string }).entity_type);
    expect(types).toContain('object');
    expect(types).toContain('mechanism');
    expect(types).toContain('participant');
  });
});
