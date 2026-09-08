import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('mechanism_participants', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    mechanism_id: {
      type: 'uuid',
      notNull: true,
      references: 'mechanisms',
      onDelete: 'CASCADE',
    },
    object_id: { type: 'uuid', notNull: true, references: 'objects', onDelete: 'RESTRICT' },
    role_code: {
      type: 'text',
      notNull: true,
      references: 'participant_roles',
      onDelete: 'RESTRICT',
    },
    note: { type: 'text' },
    sort_order: { type: 'int', notNull: true, default: 0 },
  });

  pgm.addConstraint('mechanism_participants', 'mechanism_participants_unique', {
    unique: ['mechanism_id', 'object_id', 'role_code'],
  });

  pgm.createIndex('mechanism_participants', 'mechanism_id');
  pgm.createIndex('mechanism_participants', 'object_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('mechanism_participants');
}
