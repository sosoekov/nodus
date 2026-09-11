import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, query } from '../api/client';
import type { Author, ConfigObject, Mechanism, Paged } from '../api/types';
import { FilterBar } from '../components/filters/FilterBar';
import {
  type FilterState,
  fromSearchParams,
  toSearchParams,
} from '../components/filters/model';
import { Button, Spinner, StatusBadge, TypeBadge } from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { useDictionaries } from '../hooks/useDictionaries';
import { useOnChange } from '../hooks/useLiveChanges';
import { formatRelative } from '../lib/dates';

type Segment = 'all' | 'objects' | 'mechanisms';

export function SearchPage() {
  const navigate = useNavigate();
  const { categoryByCode } = useDictionaries();
  const [params, setParams] = useSearchParams();

  const [segment, setSegment] = useState<Segment>(
    (params.get('segment') as Segment) || 'all',
  );
  const [filters, setFilters] = useState<FilterState>(() => fromSearchParams(params));

  const [objects, setObjects] = useState<Paged<ConfigObject> | null>(null);
  const [mechanisms, setMechanisms] = useState<Paged<Mechanism> | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Дребезг гасим только для строки поиска: селект в поповере меняется один
  // раз и ждать после него нечего.
  const debouncedQ = useDebounced(filters.q, 250);
  const effective = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  useEffect(() => {
    const next = toSearchParams(effective);
    if (segment !== 'all') next.set('segment', segment);
    setParams(next, { replace: true });
  }, [effective, segment, setParams]);

  useEffect(() => {
    void api
      .get<{ items: Author[] }>('/api/authors')
      .then((response) => setAuthors(response.items))
      .catch(console.error);
  }, [reloadToken]);

  const load = useCallback(async () => {
    const common = {
      q: effective.q,
      status: effective.status,
      authorId: effective.authorId,
      createdFrom: effective.createdFrom,
      createdTo: effective.createdTo,
      limit: 100,
    };

    // Статусы объектов и механизмов пересекаются не полностью: draft бывает
    // только у механизма, stub — только у объекта. Непригодный статус просто
    // обнулил бы вторую выдачу, поэтому в такой запрос не идем.
    const objectStatusFits = effective.status !== 'draft';
    const mechanismStatusFits = effective.status !== 'stub';

    const wantObjects = segment !== 'mechanisms' && objectStatusFits;
    // Категория — свойство механизма: если она выбрана, объекты не при чем.
    const wantMechanisms =
      segment !== 'objects' &&
      mechanismStatusFits &&
      !effective.type &&
      !effective.subsystem &&
      !effective.tags.length;

    const [loadedObjects, loadedMechanisms] = await Promise.all([
      wantObjects
        ? api.get<Paged<ConfigObject>>(
            `/api/objects${query({
              ...common,
              type: effective.type,
              subsystem: effective.subsystem,
              tags: effective.tags.join(','),
            })}`,
          )
        : Promise.resolve(null),
      wantMechanisms
        ? api.get<Paged<Mechanism>>(
            `/api/mechanisms${query({ ...common, category: effective.category })}`,
          )
        : Promise.resolve(null),
    ]);

    setObjects(loadedObjects);
    setMechanisms(loadedMechanisms);
  }, [effective, segment]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, reloadToken]);

  useOnChange(() => setReloadToken((value) => value + 1));

  const subsystems = useMemo(
    () => [...new Set((objects?.items ?? []).map((item) => item.subsystem).filter(Boolean))]
      .sort() as string[],
    [objects],
  );
  const tags = useMemo(
    () => [...new Set((objects?.items ?? []).flatMap((item) => item.tags))].sort(),
    [objects],
  );

  const objectCount = objects?.total ?? 0;
  const mechanismCount = mechanisms?.total ?? 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <FilterBar
        state={filters}
        onChange={setFilters}
        authors={authors}
        subsystems={subsystems}
        tags={tags}
        showCategory
      />

      <div className="mt-3 mb-3 flex flex-wrap items-center gap-2">
        {/* Один переключатель вместо двух параллельных секций: они делили
            высоту пополам, и ни одна не показывала достаточно. */}
        <div className="flex rounded border border-[var(--color-line)] bg-white p-0.5 text-sm">
          {(
            [
              ['all', 'Всё', objectCount + mechanismCount],
              ['objects', 'Объекты', objectCount],
              ['mechanisms', 'Механизмы', mechanismCount],
            ] as Array<[Segment, string, number]>
          ).map(([value, label, total]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSegment(value)}
              className={`rounded px-3 py-1 ${
                segment === value ? 'bg-blue-600 text-white' : 'text-[var(--color-muted)]'
              }`}
            >
              {label}
              <span className="ml-1.5 text-xs opacity-70">{total}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <Button onClick={() => navigate('/objects/bulk')}>Массовая вставка</Button>
          <Button variant="primary" onClick={() => navigate('/mechanisms/new')}>
            Новый механизм
          </Button>
        </div>
      </div>

      {loading && !objects && !mechanisms ? <Spinner /> : null}

      <div className="space-y-4">
        {objects ? (
          <Results
            title={segment === 'all' ? 'Объекты' : null}
            page={objects}
            render={(item: ConfigObject) => (
              <button
                type="button"
                onClick={() => navigate(`/objects/${item.id}`)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
              >
                <TypeBadge code={item.type_code} />
                <span className="min-w-0 flex-1 truncate text-sm" title={item.full_name ?? item.name}>
                  {item.full_name ?? item.name}
                </span>
                {item.author_name ? (
                  <span className="hidden shrink-0 text-xs text-[var(--color-muted)] sm:inline">
                    {item.author_name} · {formatRelative(item.updated_at)}
                  </span>
                ) : null}
                <StatusBadge status={item.status} />
              </button>
            )}
          />
        ) : null}

        {mechanisms ? (
          <Results
            title={segment === 'all' ? 'Механизмы' : null}
            page={mechanisms}
            render={(item: Mechanism) => (
              <button
                type="button"
                onClick={() => navigate(`/mechanisms/${item.id}`)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {categoryByCode.get(item.category_code)?.title ?? item.category_code}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm" title={item.summary ?? undefined}>
                  {item.title}
                </span>
                {item.author_name ? (
                  <span className="hidden shrink-0 text-xs text-[var(--color-muted)] sm:inline">
                    {item.author_name} · {formatRelative(item.updated_at)}
                  </span>
                ) : null}
                <StatusBadge status={item.status} />
              </button>
            )}
          />
        ) : null}

        {!loading && !objects?.items.length && !mechanisms?.items.length ? (
          <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-6 text-center text-sm text-[var(--color-muted)]">
            Ничего не найдено. Снимите часть фильтров или поищите по другому слову.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Results<T extends { id: string }>({
  title,
  page,
  render,
}: {
  title: string | null;
  page: Paged<T>;
  render(item: T): React.ReactNode;
}) {
  if (!page.items.length) return null;

  return (
    <section>
      <p className="mb-1.5 text-xs text-[var(--color-muted)]">
        {title ? <span className="font-medium">{title} · </span> : null}
        найдено: {page.total}
        {page.total > page.items.length ? `, показаны первые ${page.items.length}` : ''}
      </p>
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
        {page.items.map((item) => (
          <li key={item.id}>{render(item)}</li>
        ))}
      </ul>
    </section>
  );
}
