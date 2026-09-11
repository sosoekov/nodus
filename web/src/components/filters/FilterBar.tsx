import { useEffect, useRef, useState } from 'react';
import type { Author } from '../../api/types';
import { useDictionaries } from '../../hooks/useDictionaries';
import { Button, inputClass } from '../ui';
import {
  type Chip,
  DATE_PRESETS,
  type FilterState,
  activeCount,
  buildChips,
  clearFilters,
  removeChip,
} from './model';

interface Props {
  state: FilterState;
  onChange(next: FilterState): void;
  authors: Author[];
  /** Значения, реально встречающиеся в выдаче: справочников для них нет. */
  subsystems: string[];
  tags: string[];
  /** Категория механизма нужна не на всех экранах. */
  showCategory?: boolean;
  placeholder?: string;
}

const selectClass =
  'w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-sm outline-none focus:border-blue-500';

/**
 * Строка поиска, кнопка «Фильтры» и чипы активных фильтров. Сами контролы — в
 * поповере: шесть селектов в вертикальном потоке съедали высоту, которой нет,
 * и каждый новый фильтр отрезал еще.
 */
export function FilterBar({
  state,
  onChange,
  authors,
  subsystems,
  tags,
  showCategory,
  placeholder,
}: Props) {
  const { object_types, mechanism_categories, typeByCode, categoryByCode } = useDictionaries();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDocumentClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const count = activeCount(state);
  const chips = buildChips(state, {
    typeTitle: (code) => typeByCode.get(code)?.title ?? code,
    categoryTitle: (code) => categoryByCode.get(code)?.title ?? code,
    authors,
  });

  const set = (patch: Partial<FilterState>) => onChange({ ...state, ...patch });

  const toggleTag = (tag: string) => {
    set({
      tags: state.tags.includes(tag)
        ? state.tags.filter((item) => item !== tag)
        : [...state.tags, tag],
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className={`${inputClass} text-base`}
          placeholder={placeholder ?? 'Имя, часть слитного имени или слово из описания…'}
          value={state.q}
          autoFocus
          onChange={(event) => set({ q: event.target.value })}
        />

        <div ref={boxRef} className="relative shrink-0">
          <Button
            variant={count ? 'primary' : 'secondary'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Фильтры{count ? ` · ${count}` : ''}
          </Button>

          {open ? (
            <div className="absolute right-0 z-30 mt-1 w-80 space-y-3 rounded border border-[var(--color-line)] bg-white p-3 shadow-lg">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Тип объекта</span>
                <select
                  className={selectClass}
                  value={state.type}
                  onChange={(event) => set({ type: event.target.value })}
                >
                  <option value="">любой</option>
                  {object_types.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              {showCategory ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--color-muted)]">
                    Категория механизма
                  </span>
                  <select
                    className={selectClass}
                    value={state.category}
                    onChange={(event) => set({ category: event.target.value })}
                  >
                    <option value="">любая</option>
                    {mechanism_categories.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Подсистема</span>
                <select
                  className={selectClass}
                  value={state.subsystem}
                  onChange={(event) => set({ subsystem: event.target.value })}
                >
                  <option value="">любая</option>
                  {subsystems.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Теги</span>
                {tags.length ? (
                  <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          state.tags.includes(tag)
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-[var(--color-ink)] hover:bg-slate-200'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-muted)]">тегов пока нет</p>
                )}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Статус</span>
                <select
                  className={selectClass}
                  value={state.status}
                  onChange={(event) => set({ status: event.target.value })}
                >
                  <option value="">любой</option>
                  <option value="stub">заглушка</option>
                  <option value="draft">черновик</option>
                  <option value="active">активен</option>
                  <option value="deprecated">устарел</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Автор</span>
                <select
                  className={selectClass}
                  value={state.authorId}
                  onChange={(event) => set({ authorId: event.target.value })}
                >
                  <option value="">любой</option>
                  {authors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.name} ({author.object_count + author.mechanism_count})
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="mb-1 block text-xs text-[var(--color-muted)]">Дата создания</span>
                <div className="mb-1.5 flex gap-1">
                  {DATE_PRESETS.map((preset) => (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() => set({ createdFrom: preset.from(), createdTo: '' })}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-xs hover:bg-slate-200"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    className={selectClass}
                    value={state.createdFrom}
                    onChange={(event) => set({ createdFrom: event.target.value })}
                  />
                  <span className="text-xs text-[var(--color-muted)]">—</span>
                  <input
                    type="date"
                    className={selectClass}
                    value={state.createdTo}
                    onChange={(event) => set({ createdTo: event.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2 border-t border-[var(--color-line)] pt-2">
                <Button onClick={() => onChange(clearFilters(state))} disabled={!count}>
                  Сбросить всё
                </Button>
                <Button variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>
                  Готово
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip: Chip) => (
            <button
              key={`${chip.key}:${chip.value ?? ''}`}
              type="button"
              onClick={() => onChange(removeChip(state, chip))}
              className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200"
              title="Снять фильтр"
            >
              {chip.label}
              <span aria-hidden className="text-[var(--color-muted)]">
                ×
              </span>
            </button>
          ))}

          {/* Отдельная кнопка нужна с двух фильтров: снимать по одному дольше,
              чем сбросить всё и набрать заново. */}
          {count >= 2 ? (
            <button
              type="button"
              onClick={() => onChange(clearFilters(state))}
              className="text-xs text-[var(--color-muted)] underline hover:text-[var(--color-ink)]"
            >
              Сбросить всё
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
