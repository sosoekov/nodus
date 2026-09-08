import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { MechanismStatus, ObjectStatus } from '../api/types';
import { Button, ErrorNote, Spinner, StatusBadge, TypeBadge } from '../components/ui';
import { useOnChange } from '../hooks/useLiveChanges';

interface QueueObject {
  id: string;
  slug: string;
  name: string;
  full_name: string | null;
  type_code: string;
  status: ObjectStatus;
  updated_at: string;
}

interface QueueMechanism {
  id: string;
  title: string;
  category_code: string;
  status: MechanismStatus;
  summary: string | null;
  updated_at: string;
}

interface Queue {
  stubs: QueueObject[];
  unlinked_objects: QueueObject[];
  mechanisms_without_body: QueueMechanism[];
  mechanisms_without_participants: QueueMechanism[];
}

type Tab = keyof Queue;

const TABS: Array<[Tab, string, string]> = [
  ['stubs', 'Заглушки', 'заведены именем и типом, всё остальное пусто'],
  ['unlinked_objects', 'Без связей', 'объект есть, но в графе изолирован'],
  ['mechanisms_without_body', 'Без описания', 'механизм назван, но не описан'],
  [
    'mechanisms_without_participants',
    'Без участников',
    'механизм без состава в граф не попадает — это заметка, а не связь',
  ],
];

export function QueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('stubs');

  const load = useCallback(async () => {
    try {
      setQueue(await api.get<Queue>('/api/queue/incomplete'));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Коллега дозаполнил запись — она должна уйти из списка сама.
  useOnChange(() => void load());

  if (error) return <ErrorNote error={error} />;
  if (!queue) return <Spinner />;

  const items = queue[tab];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Очередь незаполненного</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Рабочий список: что заведено, но еще не описано.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded border px-3 py-1.5 text-sm ${
              tab === key
                ? 'border-blue-500 bg-blue-50 text-blue-900'
                : 'border-[var(--color-line)] bg-white'
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs text-[var(--color-muted)]">{queue[key].length}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        {TABS.find(([key]) => key === tab)?.[2]}
      </p>

      {items.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-6 text-center text-sm text-[var(--color-muted)]">
          Пусто — здесь всё заполнено.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
          {items.map((item) =>
            'title' in item ? (
              <li key={item.id}>
                <Link
                  to={`/mechanisms/${item.id}`}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">
                      {item.summary ?? 'без краткого описания'}
                    </span>
                  </span>
                  <StatusBadge status={item.status} />
                </Link>
              </li>
            ) : (
              <li key={item.id}>
                <Link
                  to={`/objects/${item.id}`}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50"
                >
                  <TypeBadge code={item.type_code} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.full_name ?? item.name}</span>
                    {item.full_name ? (
                      <span className="block truncate text-xs text-[var(--color-muted)]">
                        {item.name}
                      </span>
                    ) : null}
                  </span>
                  <StatusBadge status={item.status} />
                </Link>
              </li>
            ),
          )}
        </ul>
      )}

      <Button onClick={() => void load()}>Обновить</Button>
    </div>
  );
}
