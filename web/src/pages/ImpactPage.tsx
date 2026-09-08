import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, Spinner, StatusBadge, TypeBadge } from '../components/ui';
import { MAX_DEPTH, analyseImpact } from '../graph/analysis';
import { useGraphStore } from '../graph/store';

type Direction = 'downstream' | 'upstream';

export function ImpactPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { state, loading } = useGraphStore();

  const direction = (params.get('direction') as Direction) ?? 'downstream';
  const [depth, setDepth] = useState(MAX_DEPTH);

  const impact = useMemo(() => {
    if (!state) return [];
    return analyseImpact(state, id, direction, depth);
  }, [state, id, direction, depth]);

  const byDepth = useMemo(() => {
    const groups = new Map<number, typeof impact>();
    for (const node of impact) {
      const list = groups.get(node.depth) ?? [];
      list.push(node);
      groups.set(node.depth, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [impact]);

  if (loading && !state) return <Spinner label="Загружаем граф…" />;
  if (!state) return <Spinner />;

  const root = state.objects.get(id);
  if (!root) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-muted)]">Объект не найден в графе.</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          К поиску
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <TypeBadge code={root.type_code} />
          <StatusBadge status={root.status} />
        </div>
        <h1 className="text-xl font-semibold">{root.name}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {direction === 'downstream'
            ? 'Что сломается, если изменить этот объект'
            : 'От чего зависит этот объект'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-[var(--color-line)] bg-white p-0.5">
          {(
            [
              ['downstream', 'На что влияет'],
              ['upstream', 'От чего зависит'],
            ] as Array<[Direction, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setParams({ direction: value }, { replace: true })}
              className={`rounded px-3 py-1 text-sm ${
                direction === value ? 'bg-blue-600 text-white' : 'text-[var(--color-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-muted)]">глубина</span>
          <input
            type="range"
            min={1}
            max={MAX_DEPTH}
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          />
          <span className="w-3 tabular-nums">{depth}</span>
        </label>

        <span className="text-xs text-[var(--color-muted)]">затронуто объектов: {impact.length}</span>

        <div className="ml-auto flex gap-2">
          <Link
            to={`/graph/${id}`}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Локальный граф
          </Link>
          <Link
            to={`/objects/${id}`}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Карточка
          </Link>
        </div>
      </div>

      {impact.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-muted)]">
          {direction === 'downstream'
            ? 'Ничего не зависит от этого объекта — по крайней мере, из описанного.'
            : 'Объект ни от чего не зависит — по крайней мере, из описанного.'}
        </p>
      ) : (
        <div className="space-y-4">
          {byDepth.map(([level, nodes]) => (
            <section key={level}>
              <h2 className="mb-1.5 text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
                {level === 1 ? 'напрямую' : `через ${level} шага`} · {nodes.length}
              </h2>
              <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
                {nodes.map((node) => {
                  const object = state.objects.get(node.object_id);
                  const mechanism = state.mechanisms.get(node.via_mechanism);
                  const source = state.objects.get(node.from_object);
                  if (!object) return null;

                  return (
                    <li key={node.object_id} className="px-3 py-2">
                      <Link
                        to={`/objects/${object.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <TypeBadge code={object.type_code} />
                        <span className="truncate text-sm">{object.name}</span>
                        <StatusBadge status={object.status} />
                      </Link>
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                        {direction === 'downstream' ? 'из' : 'через'} «{source?.name ?? '?'}»
                        {mechanism ? (
                          <>
                            {' '}
                            по механизму{' '}
                            <Link to={`/mechanisms/${mechanism.id}`} className="underline">
                              {mechanism.title}
                            </Link>
                          </>
                        ) : null}
                        {node.via_role ? ` · роль ${node.via_role}` : ''}
                      </p>
                      {mechanism?.summary ? (
                        <p className="text-xs text-slate-600 italic">{mechanism.summary}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Считается по ребрам «источник → приемник» из ролей участников. Механизмы, где у объекта нет
        приемника, влияние не передают — направление в них не задано.
      </p>

      {depth < MAX_DEPTH ? (
        <Button onClick={() => setDepth(MAX_DEPTH)}>Раскрыть на всю глубину</Button>
      ) : null}
    </div>
  );
}
