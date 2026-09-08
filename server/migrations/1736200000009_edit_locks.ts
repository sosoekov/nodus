import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('edit_locks', {
    entity_type: { type: 'text', notNull: true },
    entity_id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    acquired_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    heartbeat_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('edit_locks', 'edit_locks_pkey', {
    primaryKey: ['entity_type', 'entity_id'],
  });

  pgm.addConstraint('edit_locks', 'edit_locks_entity_type_check', {
    check: "entity_type IN ('object', 'mechanism')",
  });

  pgm.createIndex('edit_locks', 'heartbeat_at');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('edit_locks');
}
