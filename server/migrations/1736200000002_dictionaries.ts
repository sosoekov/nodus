import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('object_types', {
    code: { type: 'text', primaryKey: true },
    title: { type: 'text', notNull: true },
    color: { type: 'text', notNull: true },
    sort_order: { type: 'int', notNull: true, default: 0 },
  });

  pgm.createTable('mechanism_categories', {
    code: { type: 'text', primaryKey: true },
    title: { type: 'text', notNull: true },
    sort_order: { type: 'int', notNull: true, default: 0 },
  });

  pgm.createTable('participant_roles', {
    code: { type: 'text', primaryKey: true },
    title: { type: 'text', notNull: true },
    direction: { type: 'text', notNull: true },
    sort_order: { type: 'int', notNull: true, default: 0 },
  });

  pgm.addConstraint('participant_roles', 'participant_roles_direction_check', {
    check: "direction IN ('source', 'target', 'neutral')",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('participant_roles');
  pgm.dropTable('mechanism_categories');
  pgm.dropTable('object_types');
}
