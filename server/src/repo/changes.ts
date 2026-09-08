import type { PoolClient } from 'pg';

export type EntityType = 'object' | 'mechanism' | 'participant';
export type ChangeOp = 'create' | 'update' | 'delete';

/**
 * Инвариант 2: журнал пишется в той же транзакции, что и сама правка,
 * поэтому функция принимает клиента транзакции, а не пул.
 */
export async function recordChange(
  client: PoolClient,
  entityType: EntityType,
  entityId: string,
  op: ChangeOp,
  payload: unknown,
  userId: string | null,
): Promise<number> {
  const { rows } = await client.query<{ seq: number }>(
    `INSERT INTO changes (entity_type, entity_id, op, payload, user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING seq`,
    [entityType, entityId, op, payload === undefined ? null : JSON.stringify(payload), userId],
  );
  return rows[0].seq;
}
