import { useEffect, useState } from 'react';
import type { LockState } from '../hooks/useLock';
import { Button } from './ui';

function humanAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} сек назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

/**
 * Предупреждение, а не запрет: поля остаются рабочими. Возраст считается на
 * клиенте от heartbeat_at, поэтому «30 сек назад» тикает само, без опроса
 * сервера.
 */
export function LockBanner({ state, onTakeOver }: { state: LockState; onTakeOver(): void }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  if (state.kind === 'idle' || state.kind === 'held') return null;

  const lock = state.lock;
  const ageSeconds = lock ? (Date.now() - new Date(lock.heartbeat_at).getTime()) / 1000 : 0;

  if (state.kind === 'lost') {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Блокировку перехватил {lock ? <b>{lock.user_name}</b> : 'другой пользователь'}. Сохранить
        правку все еще можно, но проверьте, что коллега не поменял то же самое.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>
        Редактирует <b>{lock?.user_name ?? 'другой пользователь'}</b>
        {lock ? `, ${humanAge(ageSeconds)}` : ''}. Поля открыты только на чтение.
      </span>
      <Button className="ml-auto" onClick={onTakeOver}>
        Все равно редактировать
      </Button>
    </div>
  );
}
