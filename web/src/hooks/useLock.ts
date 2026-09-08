import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { EditLock } from '../api/types';

const HEARTBEAT_MS = 15_000;

export type LockState =
  | { kind: 'idle' }
  | { kind: 'held'; lock: EditLock }
  | { kind: 'taken'; lock: EditLock | null }
  | { kind: 'lost'; lock: EditLock | null };

interface UseLock {
  state: LockState;
  /** «Все равно редактировать» — перебивает чужую свежую блокировку. */
  takeOver(): Promise<void>;
  retry(): Promise<void>;
}

/**
 * Мягкая блокировка редактора: берется при открытии, продлевается раз в 15
 * секунд, снимается при уходе со страницы. Это предупреждение, а не запрет —
 * поля остаются рабочими, даже когда состояние `taken`.
 */
export function useLock(
  entityType: 'object' | 'mechanism',
  entityId: string | null,
  enabled: boolean,
): UseLock {
  const [state, setState] = useState<LockState>({ kind: 'idle' });
  const heldRef = useRef(false);

  const acquire = useCallback(
    async (force: boolean) => {
      if (!entityId) return;
      try {
        const { lock } = await api.post<{ lock: EditLock }>(
          `/api/locks/${entityType}/${entityId}`,
          { force },
        );
        heldRef.current = true;
        setState({ kind: 'held', lock });
      } catch (error) {
        if (error instanceof ApiError && error.isConflict) {
          heldRef.current = false;
          const details = error.details as { lock?: EditLock } | undefined;
          setState({ kind: 'taken', lock: details?.lock ?? null });
          return;
        }
        throw error;
      }
    },
    [entityType, entityId],
  );

  useEffect(() => {
    if (!enabled || !entityId) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    void acquire(false).catch(console.error);

    const timer = setInterval(async () => {
      if (cancelled || !heldRef.current) return;
      try {
        const { lock } = await api.post<{ lock: EditLock }>(
          `/api/locks/${entityType}/${entityId}/beat`,
        );
        if (!cancelled) setState({ kind: 'held', lock });
      } catch (error) {
        // Блокировку перехватили или она протухла — редактор должен узнать об
        // этом сам, а не продолжать считать, что держит запись.
        heldRef.current = false;
        if (cancelled) return;
        const details = error instanceof ApiError ? (error.details as { lock?: EditLock }) : null;
        setState({ kind: 'lost', lock: details?.lock ?? null });
      }
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (heldRef.current) {
        heldRef.current = false;
        // Отпускаем сразу, чтобы коллега не ждал протухания все 60 секунд.
        void api.del(`/api/locks/${entityType}/${entityId}`).catch(() => {});
      }
    };
  }, [acquire, enabled, entityType, entityId]);

  return {
    state,
    takeOver: () => acquire(true),
    retry: () => acquire(false),
  };
}
