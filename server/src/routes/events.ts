import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { pool } from '../db';
import { type ChangeEvent, changeBus } from '../events/bus';

function frame(event: string, data: unknown, id?: number): string {
  const head = id === undefined ? '' : `id: ${id}\n`;
  return `${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Патчи, пропущенные за время обрыва. EventSource сам присылает Last-Event-ID,
 * так что догонку можно отдать сразу и не ждать, пока клиент сходит в
 * /api/changes. Патч — это полное новое состояние сущности, поэтому повторное
 * применение безвредно, и две догонки друг другу не мешают.
 */
async function replaySince(since: number): Promise<ChangeEvent[]> {
  const { rows } = await pool.query<ChangeEvent>(
    `SELECT seq, entity_type, entity_id, op, payload, user_id, created_at
       FROM changes WHERE seq > $1 ORDER BY seq LIMIT 5000`,
    [since],
  );
  return rows;
}

function parseLastEventId(request: FastifyRequest): number | null {
  const header = request.headers['last-event-id'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const viewer = app.requireRole('viewer');

  // Закрыть на остановке сервера нужно все открытые потоки, поэтому хук
  // регистрируется один раз на плагин, а не внутри обработчика.
  const openStreams = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const close of [...openStreams]) close();
  });

  app.get('/api/events', { onRequest: [viewer] }, async (request, reply) => {
    const { raw } = reply;

    reply.hijack();

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx иначе копит поток в буфере и патчи приходят пачками с задержкой.
      'X-Accel-Buffering': 'no',
    });

    // Пишем, пока сокет жив: после закрытия write() молча уходит в никуда.
    let closed = false;
    const send = (chunk: string) => {
      if (!closed && !raw.writableEnded) raw.write(chunk);
    };

    send(`retry: ${config.sseRetryMs}\n\n`);

    const { rows: head } = await pool.query<{ seq: number | null }>(
      'SELECT max(seq) AS seq FROM changes',
    );
    const currentSeq = head[0].seq ?? 0;

    const lastEventId = parseLastEventId(request);
    if (lastEventId !== null && lastEventId < currentSeq) {
      for (const missed of await replaySince(lastEventId)) {
        send(frame('change', missed, missed.seq));
      }
    }

    send(frame('hello', { seq: currentSeq, user_id: request.currentUser!.id }));

    const unsubscribe = changeBus.subscribe((event) => {
      send(frame('change', event, event.seq));
    });

    // Прокси рвут молчащее соединение; комментарий не виден клиенту как событие.
    const heartbeat = setInterval(() => send(': ping\n\n'), config.sseHeartbeatMs);

    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      openStreams.delete(stop);
      raw.end();
    };

    openStreams.add(stop);
    request.raw.on('close', stop);
    request.raw.on('error', stop);
    raw.on('close', stop);
  });
}
