/**
 * Фильтры, общие для списков объектов и механизмов: автор и диапазон дат
 * создания. Вынесены, чтобы условия и их экранирование не разъехались между
 * двумя роутами.
 */

export interface AuthorDateQuery {
  authorId?: string;
  createdFrom?: string;
  createdTo?: string;
}

/** Схема query-параметров — одинаковая у обоих списков. */
export const AUTHOR_DATE_PROPERTIES = {
  authorId: { type: 'string', format: 'uuid' },
  // Ровно дата, без времени: фильтр в интерфейсе — это пресеты и календарь,
  // а не момент с точностью до секунды.
  createdFrom: { type: 'string', format: 'date' },
  createdTo: { type: 'string', format: 'date' },
} as const;

/**
 * Дописывает условия в общий список. `bind` возвращает плейсхолдер для
 * значения — тот же приём, что и в остальных фильтрах списка.
 */
export function applyAuthorDateFilters(
  conditions: string[],
  bind: (value: unknown) => string,
  query: AuthorDateQuery,
): void {
  if (query.authorId) conditions.push(`created_by = ${bind(query.authorId)}`);

  if (query.createdFrom) conditions.push(`created_at >= ${bind(query.createdFrom)}::date`);

  // Верхняя граница включает весь указанный день: пользователь, выбравший
  // «по 12.03», ожидает увидеть созданное двенадцатого, а не до его начала.
  if (query.createdTo) {
    conditions.push(`created_at < ${bind(query.createdTo)}::date + interval '1 day'`);
  }
}

/**
 * Теги: любой из перечисленных. Принимаем и повторяющийся параметр, и строку
 * через запятую — ссылку со срезом руками правят чаще, чем кажется.
 */
export function parseTags(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(',');
  return [...new Set(parts.map((item) => item.trim()).filter(Boolean))];
}
