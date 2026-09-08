import { useEffect, useRef, useState } from 'react';
import { api, query } from '../api/client';
import type { ConfigObject, Paged, SimilarObject } from '../api/types';
import { useDebounced } from '../hooks/useDebounced';
import { useDictionaries } from '../hooks/useDictionaries';
import { parseFullName } from '../lib/parseFullName';
import { Button, StatusBadge, TypeBadge, inputClass } from './ui';

interface Props {
  /** Уже выбранный объект — показывается вместо строки поиска. */
  value: { id: string; name: string; full_name: string | null; type_code: string } | null;
  onSelect(object: { id: string; name: string; full_name: string | null; type_code: string }): void;
  onClear?(): void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * Поиск объекта с двумя вещами, без которых базу не наполнить:
 * создание прямо отсюда, когда в списке пусто, и предупреждение о похожих
 * именах, чтобы не завести третий «РегистрСведений.НормыДней».
 */
export function ObjectPicker({
  value,
  onSelect,
  onClear,
  placeholder,
  autoFocus,
  disabled,
}: Props) {
  const { object_types } = useDictionaries();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<ConfigObject[]>([]);
  const [similar, setSimilar] = useState<SimilarObject[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounced(text, 200);
  const parsed = parseFullName(debounced, object_types, object_types[0]?.code ?? 'Константа');

  useEffect(() => {
    if (!debounced.trim()) {
      setFound([]);
      setSimilar([]);
      return;
    }

    let cancelled = false;

    void api
      .get<Paged<ConfigObject>>(`/api/objects${query({ q: debounced, limit: 8 })}`)
      .then((page) => {
        if (!cancelled) setFound(page.items);
      })
      .catch(console.error);

    // Похожие ищем всегда: точного совпадения может не быть, а почти-дубль есть.
    void api
      .get<{ items: SimilarObject[] }>(`/api/objects/similar${query({ name: debounced, limit: 5 })}`)
      .then((response) => {
        if (!cancelled) setSimilar(response.items);
      })
      .catch(() => {
        if (!cancelled) setSimilar([]);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      // Заглушка — нормальный рабочий режим: имя, тип, и все.
      const created = await api.post<ConfigObject>('/api/objects', {
        type_code: parsed.type_code,
        name: parsed.name,
        full_name: parsed.full_name,
        status: 'stub',
      });
      onSelect(created);
      setText('');
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать объект');
    } finally {
      setCreating(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <TypeBadge code={value.type_code} />
        <span className="truncate text-sm" title={value.full_name ?? value.name}>
          {value.full_name ?? value.name}
        </span>
        {onClear && !disabled ? (
          <Button variant="ghost" className="ml-auto px-1.5 py-0.5" onClick={onClear}>
            сменить
          </Button>
        ) : null}
      </div>
    );
  }

  const exactExists = found.some(
    (item) => (item.full_name ?? item.name).toLowerCase() === debounced.trim().toLowerCase(),
  );
  const canCreate = debounced.trim().length > 1 && !exactExists;

  // Выпадающий список намеренно шире поля: в таблице участников колонка узкая,
  // а имена вроде «РегистрСведений.НормыДнейПоискаПоГородам» нужно прочитать
  // целиком — иначе подсказка про дубли бесполезна.

  // Похожие, которых нет в точной выдаче, — именно они ловят опечатки.
  const nearDuplicates = similar.filter(
    (item) => !found.some((hit) => hit.id === item.id) && item.score < 0.95,
  );

  return (
    <div ref={boxRef} className="relative">
      <input
        className={inputClass}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Начните вводить имя объекта…'}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {open && debounced.trim() ? (
        <div className="absolute z-20 mt-1 w-full min-w-96 rounded border border-[var(--color-line)] bg-white shadow-lg">
          {found.length ? (
            <ul className="max-h-56 overflow-y-auto">
              {found.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50"
                    onClick={() => {
                      onSelect(item);
                      setText('');
                      setOpen(false);
                    }}
                  >
                    <TypeBadge code={item.type_code} />
                    <span className="truncate text-sm">{item.full_name ?? item.name}</span>
                    {item.status === 'stub' ? <StatusBadge status="stub" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-sm text-[var(--color-muted)]">Ничего не найдено</p>
          )}

          {nearDuplicates.length ? (
            <div className="border-t border-[var(--color-line)] bg-amber-50 px-2.5 py-2">
              <p className="text-xs font-medium text-amber-900">Возможно, вы имеете в виду…</p>
              <ul className="mt-1 space-y-1">
                {nearDuplicates.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-amber-100"
                      onClick={() => {
                        onSelect(item);
                        setText('');
                        setOpen(false);
                      }}
                    >
                      <TypeBadge code={item.type_code} />
                      <span className="truncate text-sm">{item.full_name ?? item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canCreate ? (
            <div className="border-t border-[var(--color-line)] p-2">
              {error ? <p className="mb-1 text-xs text-red-700">{error}</p> : null}
              <Button
                variant="primary"
                className="w-full"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? 'Создаем…' : `Создать «${parsed.full_name}»`}
              </Button>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                тип {parsed.recognized ? 'по префиксу' : 'по умолчанию'}: {parsed.type_code}
                {parsed.recognized ? '' : ' — поправьте потом в карточке'}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
