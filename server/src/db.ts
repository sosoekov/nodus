import { Pool, type PoolClient, types } from 'pg';
import { config } from './config';
import { type ChangeEvent, changeBus } from './events/bus';

// bigserial приходит строкой — для seq нужен number, значения курсора заведомо
// меньше Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (value) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl });

export type Db = Pool | PoolClient;

/**
 * Патчи, накопленные транзакцией. Лежат на клиенте, чтобы recordChange не
 * пришлось таскать отдельный контекст через все репозитории.
 */
export const PENDING_CHANGES = Symbol('nodus.pendingChanges');

export type TxClient = PoolClient & { [PENDING_CHANGES]?: ChangeEvent[] };

export async function withTransaction<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
  const client = (await pool.connect()) as TxClient;
  client[PENDING_CHANGES] = [];

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');

    // Только после COMMIT: до него подписчик увидел бы патч, которого еще нет
    // в базе, и догонка через /api/changes его бы не вернула.
    changeBus.publish(client[PENDING_CHANGES] ?? []);

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    delete client[PENDING_CHANGES];
    client.release();
  }
}
