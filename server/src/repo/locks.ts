import type { Db } from '../db';
import { config } from '../config';

export type LockEntityType = 'object' | 'mechanism';

export interface LockRow {
  entity_type: LockEntityType;
  entity_id: string;
  user_id: string;
  user_name: string;
  acquired_at: string;
  heartbeat_at: string;
  /** Сколько секунд назад был последний heartbeat — из этого клиент лепит баннер. */
  age_seconds: number;
}

const SELECT_LOCK = `
  SELECT l.entity_type, l.entity_id, l.user_id, u.name AS user_name,
         l.acquired_at, l.heartbeat_at,
         extract(epoch FROM now() - l.heartbeat_at)::int AS age_seconds
    FROM edit_locks l JOIN users u ON u.id = l.user_id
`;

/** Блокировка без heartbeat дольше ttl считается протухшей и никого не держит. */
const FRESH = 'l.heartbeat_at > now() - ($3 || \' seconds\')::interval';

export async function findLock(
  db: Db,
  entityType: LockEntityType,
  entityId: string,
): Promise<LockRow | null> {
  const { rows } = await db.query<LockRow>(
    `${SELECT_LOCK} WHERE l.entity_type = $1 AND l.entity_id = $2`,
    [entityType, entityId],
  );
  return rows[0] ?? null;
}

export async function findFreshLock(
  db: Db,
  entityType: LockEntityType,
  entityId: string,
): Promise<LockRow | null> {
  const { rows } = await db.query<LockRow>(
    `${SELECT_LOCK} WHERE l.entity_type = $1 AND l.entity_id = $2 AND ${FRESH}`,
    [entityType, entityId, config.lockTtlSeconds],
  );
  return rows[0] ?? null;
}

/**
 * Пытается взять блокировку. Отдает null, если ее держит кто-то другой и она
 * еще свежая — вызывающий решает, показать баннер или перебить силой.
 */
export async function acquireLock(
  db: Db,
  entityType: LockEntityType,
  entityId: string,
  userId: string,
  force: boolean,
): Promise<LockRow | null> {
  const takeover = force
    ? 'TRUE'
    : `edit_locks.user_id = $3
       OR edit_locks.heartbeat_at <= now() - ($4 || ' seconds')::interval`;

  const { rowCount } = await db.query(
    `INSERT INTO edit_locks (entity_type, entity_id, user_id, acquired_at, heartbeat_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (entity_type, entity_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           acquired_at = CASE WHEN edit_locks.user_id = EXCLUDED.user_id
                              THEN edit_locks.acquired_at ELSE now() END,
           heartbeat_at = now()
     WHERE ${takeover}`,
    force
      ? [entityType, entityId, userId]
      : [entityType, entityId, userId, config.lockTtlSeconds],
  );

  if (!rowCount) return null;
  return findLock(db, entityType, entityId);
}

/** Продлевает блокировку, только если она все еще наша. */
export async function beatLock(
  db: Db,
  entityType: LockEntityType,
  entityId: string,
  userId: string,
): Promise<LockRow | null> {
  const { rowCount } = await db.query(
    `UPDATE edit_locks SET heartbeat_at = now()
      WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3`,
    [entityType, entityId, userId],
  );

  if (!rowCount) return null;
  return findLock(db, entityType, entityId);
}

export async function releaseLock(
  db: Db,
  entityType: LockEntityType,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM edit_locks WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3',
    [entityType, entityId, userId],
  );
  return Boolean(rowCount);
}
