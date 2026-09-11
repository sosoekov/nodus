import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Индексы под фильтры по автору и диапазону дат создания. Без них фильтрация
 * на нескольких сотнях записей упирается в последовательное сканирование, а
 * список отдается постранично и сортируется как раз по этим полям.
 *
 * Частичные по deleted_at IS NULL: мягко удаленное в выдачу не попадает
 * никогда, и держать его в индексе незачем.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('objects', 'created_by', {
    name: 'objects_created_by_idx',
    where: 'deleted_at IS NULL',
  });
  pgm.createIndex('objects', 'created_at', {
    name: 'objects_created_at_idx',
    where: 'deleted_at IS NULL',
  });

  pgm.createIndex('mechanisms', 'created_by', {
    name: 'mechanisms_created_by_idx',
    where: 'deleted_at IS NULL',
  });
  pgm.createIndex('mechanisms', 'created_at', {
    name: 'mechanisms_created_at_idx',
    where: 'deleted_at IS NULL',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('mechanisms', 'created_at', { name: 'mechanisms_created_at_idx' });
  pgm.dropIndex('mechanisms', 'created_by', { name: 'mechanisms_created_by_idx' });
  pgm.dropIndex('objects', 'created_at', { name: 'objects_created_at_idx' });
  pgm.dropIndex('objects', 'created_by', { name: 'objects_created_by_idx' });
}
