import type { Author } from '../../api/types';

/**
 * Состояние фильтров живет в URL, а не в компоненте: срез нужно уметь
 * отправить ссылкой, а браузерная кнопка «назад» должна возвращать прошлый
 * набор, а не выбрасывать со страницы.
 */
export interface FilterState {
  q: string;
  type: string;
  subsystem: string;
  tags: string[];
  status: string;
  category: string;
  authorId: string;
  createdFrom: string;
  createdTo: string;
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  type: '',
  subsystem: '',
  tags: [],
  status: '',
  category: '',
  authorId: '',
  createdFrom: '',
  createdTo: '',
};

/** Поиск — не фильтр: у него своя строка, и в чипы он не попадает. */
const FILTER_KEYS = [
  'type',
  'subsystem',
  'tags',
  'status',
  'category',
  'authorId',
  'createdFrom',
  'createdTo',
] as const;

export function fromSearchParams(params: URLSearchParams): FilterState {
  return {
    q: params.get('q') ?? '',
    type: params.get('type') ?? '',
    subsystem: params.get('subsystem') ?? '',
    tags: (params.get('tags') ?? '').split(',').filter(Boolean),
    status: params.get('status') ?? '',
    category: params.get('category') ?? '',
    authorId: params.get('authorId') ?? '',
    createdFrom: params.get('createdFrom') ?? '',
    createdTo: params.get('createdTo') ?? '',
  };
}

export function toSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const key of FILTER_KEYS) {
    const value = state[key];
    const serialized = Array.isArray(value) ? value.join(',') : value;
    if (serialized) params.set(key, serialized);
  }
  return params;
}

export function activeCount(state: FilterState): number {
  return FILTER_KEYS.reduce((count, key) => {
    const value = state[key];
    return count + (Array.isArray(value) ? (value.length ? 1 : 0) : value ? 1 : 0);
  }, 0);
}

export interface Chip {
  key: keyof FilterState;
  /** Для тегов — какой именно снять: их может быть несколько в одном фильтре. */
  value?: string;
  label: string;
}

interface Labels {
  typeTitle(code: string): string;
  categoryTitle(code: string): string;
  authors: Author[];
}

const STATUS_LABELS: Record<string, string> = {
  stub: 'заглушка',
  draft: 'черновик',
  active: 'активен',
  deprecated: 'устарел',
};

function humanDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function buildChips(state: FilterState, labels: Labels): Chip[] {
  const chips: Chip[] = [];

  if (state.type) chips.push({ key: 'type', label: `Тип: ${labels.typeTitle(state.type)}` });
  if (state.subsystem) chips.push({ key: 'subsystem', label: `Подсистема: ${state.subsystem}` });

  for (const tag of state.tags) {
    chips.push({ key: 'tags', value: tag, label: `Тег: ${tag}` });
  }

  if (state.status) {
    chips.push({ key: 'status', label: `Статус: ${STATUS_LABELS[state.status] ?? state.status}` });
  }
  if (state.category) {
    chips.push({ key: 'category', label: `Категория: ${labels.categoryTitle(state.category)}` });
  }
  if (state.authorId) {
    const author = labels.authors.find((item) => item.id === state.authorId);
    chips.push({ key: 'authorId', label: `Автор: ${author?.name ?? 'неизвестен'}` });
  }
  if (state.createdFrom) {
    chips.push({ key: 'createdFrom', label: `Создан: с ${humanDate(state.createdFrom)}` });
  }
  if (state.createdTo) {
    chips.push({ key: 'createdTo', label: `Создан: по ${humanDate(state.createdTo)}` });
  }

  return chips;
}

export function removeChip(state: FilterState, chip: Chip): FilterState {
  if (chip.key === 'tags' && chip.value) {
    return { ...state, tags: state.tags.filter((tag) => tag !== chip.value) };
  }
  return { ...state, [chip.key]: Array.isArray(state[chip.key]) ? [] : '' };
}

/** Сбрасывает фильтры, оставляя строку поиска: она набрана отдельно. */
export function clearFilters(state: FilterState): FilterState {
  return { ...EMPTY_FILTERS, q: state.q };
}

const DAY = 86_400_000;

const isoDate = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);

export const DATE_PRESETS: Array<{ code: string; label: string; from(): string }> = [
  { code: 'today', label: 'сегодня', from: () => isoDate(Date.now()) },
  { code: 'week', label: 'неделя', from: () => isoDate(Date.now() - 7 * DAY) },
  { code: 'month', label: 'месяц', from: () => isoDate(Date.now() - 30 * DAY) },
];
