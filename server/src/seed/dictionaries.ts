import type { PoolClient } from 'pg';

const OBJECT_TYPES: Array<[code: string, title: string, color: string]> = [
  ['Константа', 'Константа', '#e0b400'],
  ['Документ', 'Документ', '#3f7fd8'],
  ['Справочник', 'Справочник', '#2f9e6f'],
  ['РегистрСведений', 'Регистр сведений', '#8b5cd6'],
  ['РегистрНакопления', 'Регистр накопления', '#b054a8'],
  ['Обработка', 'Обработка', '#d97742'],
  ['Отчет', 'Отчет', '#c0483f'],
  ['Роль', 'Роль', '#7a8794'],
  ['Подсистема', 'Подсистема', '#5a6570'],
  ['ОбщийМодуль', 'Общий модуль', '#4a8f8f'],
  ['Реквизит', 'Реквизит', '#9aa5b1'],
  ['Измерение', 'Измерение', '#8fa3bf'],
  ['Ресурс', 'Ресурс', '#8fbf9f'],
];

const MECHANISM_CATEGORIES: Array<[code: string, title: string]> = [
  ['Расчет', 'Расчет'],
  ['Заполнение', 'Заполнение'],
  ['Проверка', 'Проверка'],
  ['Обмен', 'Обмен'],
  ['ПраваДоступа', 'Права доступа'],
  ['Печать', 'Печать'],
];

const PARTICIPANT_ROLES: Array<[code: string, title: string, direction: string]> = [
  ['Источник', 'Источник', 'source'],
  ['Приемник', 'Приемник', 'target'],
  ['Параметр', 'Параметр', 'source'],
  ['Условие', 'Условие', 'source'],
  ['Переопределение', 'Переопределение', 'source'],
  ['ЗначениеПоУмолчанию', 'Значение по умолчанию', 'source'],
  ['Участник', 'Участник', 'neutral'],
];

export async function seedDictionaries(client: PoolClient): Promise<void> {
  for (const [index, [code, title, color]] of OBJECT_TYPES.entries()) {
    await client.query(
      `INSERT INTO object_types (code, title, color, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, color = EXCLUDED.color,
         sort_order = EXCLUDED.sort_order`,
      [code, title, color, index * 10],
    );
  }

  for (const [index, [code, title]] of MECHANISM_CATEGORIES.entries()) {
    await client.query(
      `INSERT INTO mechanism_categories (code, title, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order`,
      [code, title, index * 10],
    );
  }

  for (const [index, [code, title, direction]] of PARTICIPANT_ROLES.entries()) {
    await client.query(
      `INSERT INTO participant_roles (code, title, direction, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, direction = EXCLUDED.direction,
         sort_order = EXCLUDED.sort_order`,
      [code, title, direction, index * 10],
    );
  }
}
