import type { ObjectType } from '../api/types';

export interface ParsedLine {
  /** Исходная строка, как её вставили. */
  raw: string;
  full_name: string;
  name: string;
  type_code: string;
  /** Тип угадан по префиксу, а не подставлен запасным вариантом. */
  recognized: boolean;
}

/**
 * Тип определяется по префиксу до первой точки: «Документ.ЗаявкаНаПодбор» →
 * Документ. Коды типов в справочнике совпадают с префиксами 1С, поэтому
 * отдельной таблицы соответствий не нужно — она бы разъехалась со справочником.
 */
export function parseFullName(raw: string, types: ObjectType[], fallback: string): ParsedLine {
  const full_name = raw.trim();
  const dot = full_name.indexOf('.');
  const prefix = dot === -1 ? '' : full_name.slice(0, dot);

  const matched = types.find((type) => type.code.toLowerCase() === prefix.toLowerCase());
  const tail = dot === -1 ? full_name : full_name.slice(dot + 1);

  return {
    raw,
    full_name,
    // Имя без префикса: в карточке и так виден тип, дублировать его незачем.
    name: tail || full_name,
    type_code: matched?.code ?? fallback,
    recognized: Boolean(matched),
  };
}

export function parseBulkInput(
  text: string,
  types: ObjectType[],
  fallback: string,
): ParsedLine[] {
  const seen = new Set<string>();
  const result: ParsedLine[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Одинаковые строки внутри одной вставки схлопываем сразу: незачем гонять
    // их на сервер, чтобы он ответил «уже есть».
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push(parseFullName(trimmed, types, fallback));
  }

  return result;
}
