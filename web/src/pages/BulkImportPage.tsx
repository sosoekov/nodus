import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ConfigObject } from '../api/types';
import { Button, ErrorNote, Field, TypeBadge, inputClass } from '../components/ui';
import { useDictionaries } from '../hooks/useDictionaries';
import { type ParsedLine, parseBulkInput } from '../lib/parseFullName';

interface Result {
  created: ConfigObject[];
  skipped: Array<{ full_name: string | null; name: string; reason: string }>;
}

const EXAMPLE = [
  'Документ.ЗаявкаНаПодборПерсонала',
  'РегистрСведений.НормыДнейПоискаПоГородам',
  'Константа.НормаДнейПоиска',
  'Справочник.Города',
].join('\n');

export function BulkImportPage() {
  const navigate = useNavigate();
  const { object_types } = useDictionaries();
  const fallback = object_types[0]?.code ?? 'Константа';

  const [text, setText] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);

  const parsed = useMemo(
    () => parseBulkInput(text, object_types, fallback),
    [text, object_types, fallback],
  );

  const typeFor = (line: ParsedLine, index: number) => overrides[index] ?? line.type_code;
  const unrecognized = parsed.filter((line, index) => !line.recognized && !overrides[index]).length;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      setResult(
        await api.post<Result>('/api/objects/bulk', {
          items: parsed.map((line, index) => ({
            type_code: typeFor(line, index),
            name: line.name,
            full_name: line.full_name,
            status: 'stub',
          })),
        }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Вставка выполнена</h1>
        <p className="text-sm">
          создано: <b>{result.created.length}</b>, пропущено как уже существующие:{' '}
          <b>{result.skipped.length}</b>
        </p>

        {result.skipped.length ? (
          <ul className="rounded border border-[var(--color-line)] bg-white text-sm">
            {result.skipped.map((item) => (
              <li key={item.full_name ?? item.name} className="border-b px-3 py-1.5 last:border-0">
                {item.full_name ?? item.name}
              </li>
            ))}
          </ul>
        ) : null}

        <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
          {result.created.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                onClick={() => navigate(`/objects/${item.id}`)}
              >
                <TypeBadge code={item.type_code} />
                <span className="truncate text-sm">{item.full_name ?? item.name}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setResult(null);
              setText('');
              setOverrides({});
            }}
          >
            Вставить еще
          </Button>
          <Button onClick={() => navigate('/')}>К поиску</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Массовая вставка объектов</h1>

      <ErrorNote error={error} />

      <Field
        label="Полные имена, по одному в строке"
        hint="тип определяется по префиксу до первой точки; повторы внутри вставки схлопываются"
      >
        <textarea
          className={`${inputClass} min-h-40 font-mono text-xs`}
          placeholder={EXAMPLE}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOverrides({});
          }}
        />
      </Field>

      {parsed.length ? (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
              Разбор — проверьте типы
            </h2>
            {unrecognized ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                тип не распознан: {unrecognized}
              </span>
            ) : null}
            <span className="ml-auto text-xs text-[var(--color-muted)]">строк: {parsed.length}</span>
          </div>

          <table className="w-full overflow-hidden rounded border border-[var(--color-line)] bg-white text-sm">
            <thead className="bg-slate-50 text-left text-xs text-[var(--color-muted)]">
              <tr>
                <th className="w-1/2 px-3 py-1.5 font-medium">Полное имя</th>
                <th className="w-1/3 px-3 py-1.5 font-medium">Имя</th>
                <th className="px-3 py-1.5 font-medium">Тип</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {parsed.map((line, index) => (
                <tr
                  key={line.full_name}
                  className={!line.recognized && !overrides[index] ? 'bg-amber-50' : ''}
                >
                  <td className="max-w-0 truncate px-3 py-1.5 font-mono text-xs">
                    {line.full_name}
                  </td>
                  <td className="max-w-0 truncate px-3 py-1.5">{line.name}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <select
                      className="rounded border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-xs"
                      value={typeFor(line, index)}
                      onChange={(event) =>
                        setOverrides((current) => ({ ...current, [index]: event.target.value }))
                      }
                    >
                      {object_types.map((type) => (
                        <option key={type.code} value={type.code}>
                          {type.title}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Все создается со статусом «заглушка». Уже существующие полные имена сервер пропустит.
          </p>
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={saving || !parsed.length}
          onClick={() => void submit()}
        >
          {saving ? 'Создаем…' : `Создать ${parsed.length || ''}`.trim()}
        </Button>
        <Button onClick={() => navigate('/')}>Отмена</Button>
      </div>
    </div>
  );
}
