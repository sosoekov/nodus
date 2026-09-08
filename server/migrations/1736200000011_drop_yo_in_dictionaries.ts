import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Коды справочников — первичные ключи, на которые ссылаются objects.type_code,
 * mechanisms.category_code и mechanism_participants.role_code. Поправить один
 * сид недостаточно: на уже засеянной базе он добавил бы запись с новым кодом
 * рядом со старой. Поэтому каждое переименование — вставка нового кода,
 * перевод ссылок на него, удаление старого.
 *
 * На чистой базе миграция идет до сида и не делает ничего.
 */
interface Rename {
  /** Справочник и таблица, которая на него ссылается. */
  table: string;
  referencing: string;
  column: string;
  /** Колонки справочника, кроме code, title и sort_order. */
  extraColumn?: string;
  oldCode: string;
  oldTitle: string;
  newCode: string;
  newTitle: string;
}

const RENAMES: Rename[] = [
  {
    table: 'object_types',
    referencing: 'objects',
    column: 'type_code',
    extraColumn: 'color',
    oldCode: 'Отчёт',
    oldTitle: 'Отчёт',
    newCode: 'Отчет',
    newTitle: 'Отчет',
  },
  {
    table: 'mechanism_categories',
    referencing: 'mechanisms',
    column: 'category_code',
    oldCode: 'Расчёт',
    oldTitle: 'Расчёт',
    newCode: 'Расчет',
    newTitle: 'Расчет',
  },
  {
    table: 'participant_roles',
    referencing: 'mechanism_participants',
    column: 'role_code',
    extraColumn: 'direction',
    oldCode: 'Приёмник',
    oldTitle: 'Приёмник',
    newCode: 'Приемник',
    newTitle: 'Приемник',
  },
];

/** pgm.sql принимает готовый SQL, поэтому литералы экранируем сами. */
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function rename(pgm: MigrationBuilder, entry: Rename, reverse: boolean): void {
  const fromCode = quote(reverse ? entry.newCode : entry.oldCode);
  const toCode = quote(reverse ? entry.oldCode : entry.newCode);
  const toTitle = quote(reverse ? entry.oldTitle : entry.newTitle);

  const extra = entry.extraColumn ? `, ${entry.extraColumn}` : '';

  pgm.sql(`
    INSERT INTO ${entry.table} (code, title, sort_order${extra})
    SELECT ${toCode}, ${toTitle}, sort_order${extra} FROM ${entry.table} WHERE code = ${fromCode}
    ON CONFLICT (code) DO NOTHING
  `);

  pgm.sql(
    `UPDATE ${entry.referencing} SET ${entry.column} = ${toCode}
      WHERE ${entry.column} = ${fromCode}`,
  );

  pgm.sql(`DELETE FROM ${entry.table} WHERE code = ${fromCode}`);
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const entry of RENAMES) rename(pgm, entry, false);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  for (const entry of RENAMES) rename(pgm, entry, true);
}
