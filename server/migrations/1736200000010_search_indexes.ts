import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Полнотекстовый поиск, русская конфигурация.
  pgm.sql(`
    ALTER TABLE objects ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('russian', coalesce(full_name, '')), 'A') ||
        setweight(to_tsvector('russian', coalesce(description, '')), 'B')
      ) STORED
  `);
  pgm.createIndex('objects', 'search_vector', {
    name: 'objects_search_vector_idx',
    method: 'gin',
  });

  pgm.sql(`
    ALTER TABLE mechanisms ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('russian', coalesce(summary, '')), 'B') ||
        setweight(to_tsvector('russian', coalesce(body, '')), 'C')
      ) STORED
  `);
  pgm.createIndex('mechanisms', 'search_vector', {
    name: 'mechanisms_search_vector_idx',
    method: 'gin',
  });

  // Триграммы — ловим дубли при заведении объектов.
  pgm.sql(`CREATE INDEX objects_name_trgm_idx ON objects USING gin (name gin_trgm_ops)`);
  pgm.sql(
    `CREATE INDEX objects_full_name_trgm_idx ON objects USING gin (full_name gin_trgm_ops)`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS objects_full_name_trgm_idx`);
  pgm.sql(`DROP INDEX IF EXISTS objects_name_trgm_idx`);
  pgm.dropIndex('mechanisms', 'search_vector', { name: 'mechanisms_search_vector_idx' });
  pgm.dropColumn('mechanisms', 'search_vector');
  pgm.dropIndex('objects', 'search_vector', { name: 'objects_search_vector_idx' });
  pgm.dropColumn('objects', 'search_vector');
}
