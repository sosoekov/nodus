import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('objects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    slug: { type: 'text', notNull: true, unique: true },
    type_code: { type: 'text', notNull: true, references: 'object_types', onDelete: 'RESTRICT' },
    name: { type: 'text', notNull: true },
    full_name: { type: 'text' },
    parent_id: { type: 'uuid', references: 'objects', onDelete: 'RESTRICT' },
    subsystem: { type: 'text' },
    tags: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
    description: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'stub' },
    version: { type: 'int', notNull: true, default: 1 },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    deleted_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('objects', 'objects_status_check', {
    check: "status IN ('stub', 'active', 'deprecated')",
  });

  pgm.addConstraint('objects', 'objects_parent_not_self_check', {
    check: 'parent_id IS NULL OR parent_id <> id',
  });

  pgm.createIndex('objects', 'parent_id');
  pgm.createIndex('objects', 'type_code');
  pgm.createIndex('objects', 'subsystem');
  pgm.createIndex('objects', 'tags', { method: 'gin' });
  pgm.createIndex('objects', 'deleted_at', { where: 'deleted_at IS NULL' });

  // Инвариант 4: дерево максимум на два уровня — объект → его реквизиты.
  // Реквизит реквизита не бывает, и у объекта с детьми не может появиться родитель.
  pgm.createFunction(
    'objects_enforce_two_levels',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `
    DECLARE
      parent_has_parent boolean;
      has_children boolean;
    BEGIN
      IF NEW.parent_id IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT o.parent_id IS NOT NULL INTO parent_has_parent
        FROM objects o WHERE o.id = NEW.parent_id;

      IF parent_has_parent THEN
        RAISE EXCEPTION 'object % cannot be a child of %: nesting is limited to two levels',
          NEW.id, NEW.parent_id USING ERRCODE = 'check_violation';
      END IF;

      SELECT EXISTS (SELECT 1 FROM objects o WHERE o.parent_id = NEW.id) INTO has_children;

      IF has_children THEN
        RAISE EXCEPTION 'object % owns children and cannot become a child itself', NEW.id
          USING ERRCODE = 'check_violation';
      END IF;

      RETURN NEW;
    END;
    `,
  );

  pgm.createTrigger('objects', 'objects_two_levels_trg', {
    when: 'BEFORE',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'objects_enforce_two_levels',
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTrigger('objects', 'objects_two_levels_trg');
  pgm.dropFunction('objects_enforce_two_levels', []);
  pgm.dropTable('objects');
}
