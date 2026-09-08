import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('changes', {
    seq: { type: 'bigserial', primaryKey: true },
    entity_type: { type: 'text', notNull: true },
    entity_id: { type: 'uuid', notNull: true },
    op: { type: 'text', notNull: true },
    payload: { type: 'jsonb' },
    user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('changes', 'changes_entity_type_check', {
    check: "entity_type IN ('object', 'mechanism', 'participant')",
  });

  pgm.addConstraint('changes', 'changes_op_check', {
    check: "op IN ('create', 'update', 'delete')",
  });

  pgm.createIndex('changes', ['entity_type', 'entity_id']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('changes');
}
