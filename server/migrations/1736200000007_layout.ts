import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('layout', {
    object_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'objects',
      onDelete: 'CASCADE',
    },
    x: { type: 'double precision', notNull: true, default: 0 },
    y: { type: 'double precision', notNull: true, default: 0 },
    pinned: { type: 'boolean', notNull: true, default: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('layout');
}
