import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true, default: 'viewer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('viewer', 'editor', 'admin')",
  });

  // Логин регистронезависим, поэтому email хранится только в нижнем регистре.
  pgm.addConstraint('users', 'users_email_lowercase_check', {
    check: 'email = lower(email)',
  });

}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('users');
}
