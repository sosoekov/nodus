import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('mechanisms', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    title: { type: 'text', notNull: true },
    category_code: {
      type: 'text',
      notNull: true,
      references: 'mechanism_categories',
      onDelete: 'RESTRICT',
    },
    summary: { type: 'text' },
    body: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'draft' },
    version: { type: 'int', notNull: true, default: 1 },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('mechanisms', 'mechanisms_status_check', {
    check: "status IN ('draft', 'active', 'deprecated')",
  });

  pgm.addConstraint('mechanisms', 'mechanisms_summary_length_check', {
    check: 'summary IS NULL OR char_length(summary) <= 200',
  });

  pgm.createIndex('mechanisms', 'category_code');
  pgm.createIndex('mechanisms', 'deleted_at', { where: 'deleted_at IS NULL' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('mechanisms');
}
