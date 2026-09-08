import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Spinner, StatusBadge, TypeBadge } from '../components/ui';
import { ObjectPicker } from '../components/ObjectPicker';
import { MAX_DEPTH, MAX_PATHS, findPaths } from '../graph/analysis';
import { useGraphStore } from '../graph/store';

interface Picked {
  id: string;
  name: string;
  full_name: string | null;
  type_code: string;
}

export function PathsPage() {
  const { state, loading } = useGraphStore();
  const [from, setFrom] = useState<Picked | null>(null);
  const [to, setTo] = useState<Picked | null>(null);
  const [directed, setDirected] = useState(false);

  const result = useMemo(() => {
    if (!state || !from || !to) return null;
    // Считается на клиенте: полный список ребер уже в памяти после снапшота,
    // обход в ширину с ограничением глубины отрабатывает мгновенно.
    return findPaths(state, from.id, to.id, { directed });
  }, [state, from, to, directed]);

  if (loading && !state) return <Spinner label="Загружаем граф…" />;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Пути между объектами</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Цепочки «объект → механизм → объект». Глубина не больше {MAX_DEPTH}, показывается не
          больше {MAX_PATHS} путей.
        </p>
      </div>

      <div className="grid gap-3 rounded border border-[var(--color-line)] bg-white p-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Откуда</p>
          <ObjectPicker value={from} onSelect={setFrom} onClear={() => setFrom(null)} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Куда</p>
          <ObjectPicker value={to} onSelect={setTo} onClear={() => setTo(null)} />
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={directed}
            onChange={(event) => setDirected(event.target.checked)}
          />
          Только по направлению влияния (источник → приемник)
        </label>
      </div>

      {from && to && from.id === to.id ? (
        <p className="text-sm text-[var(--color-muted)]">Выбран один и тот же объект.</p>
      ) : null}

      {result ? (
        result.paths.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-muted)]">
            Связей не нашлось. Возможно, объекты действительно не связаны — или цепочка длиннее{' '}
            {MAX_DEPTH} шагов.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-muted)]">
              найдено путей: {result.paths.length}
              {result.truncated ? ` (показаны первые ${result.paths.length}, есть еще)` : ''}
            </p>

            {result.paths.map((path, index) => (
              <ol
                key={`${path.objects.join('>')}-${index}`}
                className="overflow-hidden rounded border border-[var(--color-line)] bg-white"
              >
                {path.objects.map((objectId, step) => {
                  const object = state!.objects.get(objectId);
                  const link = step > 0 ? path.steps[step - 1] : null;
                  const mechanism = link ? state!.mechanisms.get(link.mechanism_id) : null;

                  return (
                    <li key={`${objectId}-${step}`}>
                      {mechanism ? (
                        <div className="border-t border-[var(--color-line)] bg-slate-50 px-3 py-1.5">
                          <Link
                            to={`/mechanisms/${mechanism.id}`}
                            className="text-xs font-medium hover:underline"
                          >
                            ↓ {mechanism.title}
                          </Link>
                          {mechanism.summary ? (
                            <p className="text-xs text-[var(--color-muted)]">{mechanism.summary}</p>
                          ) : null}
                          <p className="text-xs text-[var(--color-muted)]">
                            {link!.from_role} → {link!.to_role}
                          </p>
                        </div>
                      ) : null}

                      {object ? (
                        <Link
                          to={`/objects/${object.id}`}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                        >
                          <TypeBadge code={object.type_code} />
                          <span className="truncate text-sm">
                            {object.name}
                          </span>
                          <StatusBadge status={object.status} />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-[var(--color-muted)]">Выберите два объекта.</p>
      )}

      {from ? (
        <div className="flex gap-2">
          <Link
            to={`/impact/${from.id}`}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Анализ влияния для «{from.name}»
          </Link>
          <Button onClick={() => { setFrom(null); setTo(null); }}>Сбросить</Button>
        </div>
      ) : null}
    </div>
  );
}
