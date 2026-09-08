import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, query } from '../api/client';
import type { ConfigObject, Mechanism, Paged } from '../api/types';
import { Button, Spinner, StatusBadge, TypeBadge, inputClass } from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { useDictionaries } from '../hooks/useDictionaries';
import { useOnChange } from '../hooks/useLiveChanges';

type Tab = 'objects' | 'mechanisms';

export function SearchPage() {
  const navigate = useNavigate();
  const { object_types, mechanism_categories } = useDictionaries();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('objects');
  const [text, setText] = useState(params.get('q') ?? '');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');

  const [objects, setObjects] = useState<Paged<ConfigObject> | null>(null);
  const [mechanisms, setMechanisms] = useState<Paged<Mechanism> | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const q = useDebounced(text, 250);

  useEffect(() => {
    setParams(q ? { q } : {}, { replace: true });
  }, [q, setParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const request =
      tab === 'objects'
        ? api
            .get<Paged<ConfigObject>>(
              `/api/objects${query({ q, type, status, subsystem, tag, limit: 100 })}`,
            )
            .then((page) => !cancelled && setObjects(page))
        : api
            .get<Paged<Mechanism>>(
              `/api/mechanisms${query({ q, category, status, limit: 100 })}`,
            )
            .then((page) => !cancelled && setMechanisms(page));

    void request.catch(console.error).finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [tab, q, type, status, subsystem, tag, category, reloadToken]);

  // Кто-то завел или поправил запись — выдача устарела, перечитываем.
  useOnChange(() => setReloadToken((value) => value + 1));

  // Подсистемы и теги в справочниках не заведены, поэтому фильтры собираем из
  // того, что реально встретилось в выдаче.
  const subsystems = useMemo(
    () => [...new Set((objects?.items ?? []).map((item) => item.subsystem).filter(Boolean))].sort(),
    [objects],
  );
  const tags = useMemo(
    () => [...new Set((objects?.items ?? []).flatMap((item) => item.tags))].sort(),
    [objects],
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex gap-2">
        <input
          className={`${inputClass} text-base`}
          placeholder="Имя объекта, часть слитного имени или слово из описания…"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded border border-[var(--color-line)] bg-white p-0.5">
          {(['objects', 'mechanisms'] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded px-3 py-1 ${tab === item ? 'bg-blue-600 text-white' : 'text-[var(--color-muted)]'}`}
            >
              {item === 'objects' ? 'Объекты' : 'Механизмы'}
            </button>
          ))}
        </div>

        {tab === 'objects' ? (
          <>
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">все типы</option>
              {object_types.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={subsystem}
              onChange={(e) => setSubsystem(e.target.value)}
            >
              <option value="">все подсистемы</option>
              {subsystems.map((item) => (
                <option key={item} value={item!}>
                  {item}
                </option>
              ))}
            </select>
            <select className={selectClass} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">все теги</option>
              {tags.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">любой статус</option>
              <option value="stub">заглушка</option>
              <option value="active">активен</option>
              <option value="deprecated">устарел</option>
            </select>
          </>
        ) : (
          <>
            <select
              className={selectClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">все категории</option>
              {mechanism_categories.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">любой статус</option>
              <option value="draft">черновик</option>
              <option value="active">активен</option>
              <option value="deprecated">устарел</option>
            </select>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <Button onClick={() => navigate('/objects/bulk')}>Массовая вставка</Button>
          <Button variant="primary" onClick={() => navigate('/mechanisms/new')}>
            Новый механизм
          </Button>
        </div>
      </div>

      {loading && !objects && !mechanisms ? <Spinner /> : null}

      {tab === 'objects' ? (
        <ObjectResults page={objects} onOpen={(id) => navigate(`/objects/${id}`)} />
      ) : (
        <MechanismResults page={mechanisms} onOpen={(id) => navigate(`/mechanisms/${id}`)} />
      )}
    </div>
  );
}

const selectClass =
  'rounded border border-[var(--color-line)] bg-white px-2 py-1 text-sm outline-none focus:border-blue-500';

function ObjectResults({
  page,
  onOpen,
}: {
  page: Paged<ConfigObject> | null;
  onOpen(id: string): void;
}) {
  if (!page) return null;
  if (!page.items.length) {
    return <p className="p-4 text-sm text-[var(--color-muted)]">Ничего не найдено</p>;
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-muted)]">
        найдено: {page.total}
        {page.total > page.items.length ? `, показаны первые ${page.items.length}` : ''}
      </p>
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
        {page.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
            >
              <TypeBadge code={item.type_code} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.full_name ?? item.name}</span>
                {item.full_name ? (
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    {item.name}
                    {item.subsystem ? ` · ${item.subsystem}` : ''}
                  </span>
                ) : null}
              </span>
              {item.tags.map((value) => (
                <span key={value} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {value}
                </span>
              ))}
              <StatusBadge status={item.status} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function MechanismResults({
  page,
  onOpen,
}: {
  page: Paged<Mechanism> | null;
  onOpen(id: string): void;
}) {
  const { categoryByCode } = useDictionaries();
  if (!page) return null;
  if (!page.items.length) {
    return <p className="p-4 text-sm text-[var(--color-muted)]">Ничего не найдено</p>;
  }

  return (
    <>
      <p className="mb-2 text-xs text-[var(--color-muted)]">найдено: {page.total}</p>
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
        {page.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-[var(--color-muted)]">
                  {categoryByCode.get(item.category_code)?.title ?? item.category_code}
                  {item.summary ? ` · ${item.summary}` : ''}
                </span>
              </span>
              <StatusBadge status={item.status} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
