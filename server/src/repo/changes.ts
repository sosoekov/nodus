import { PENDING_CHANGES, type TxClient } from '../db';
import type { ChangeEvent } from '../events/bus';

export type EntityType = ChangeEvent['entity_type'];
export type ChangeOp = ChangeEvent['op'];

/**
 * Инвариант 2: журнал пишется в той же транзакции, что и сама правка,
 * поэтому функция принимает клиента транзакции, а не пул.
 *
 * Здесь же патч кладется в буфер транзакции — рассылка уйдет после коммита,
 * так что записать правку и не разослать ее нельзя, как и наоборот.
 */
export async function recordChange(
  client: TxClient,
  entityType: EntityType,
  entityId: string,
  op: ChangeOp,
  payload: unknown,
  userId: string | null,
): Promise<number> {
  const { rows } = await client.query<{ seq: number; created_at: string }>(
    `INSERT INTO changes (entity_type, entity_id, op, payload, user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING seq, created_at`,
    [entityType, entityId, op, payload === undefined ? null : JSON.stringify(payload), userId],
  );

  const { seq, created_at } = rows[0];

  client[PENDING_CHANGES]?.push({
    seq,
    entity_type: entityType,
    entity_id: entityId,
    op,
    payload: payload ?? null,
    user_id: userId,
    created_at,
  });

  return seq;
}
