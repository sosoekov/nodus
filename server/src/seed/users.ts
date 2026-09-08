import type { PoolClient } from 'pg';
import { hashPassword } from '../auth/password';

const SEED_USERS: Array<[email: string, name: string, role: string]> = [
  ['admin@nodus.local', 'Администратор', 'admin'],
  ['editor@nodus.local', 'Редактор', 'editor'],
  ['viewer@nodus.local', 'Читатель', 'viewer'],
];

/** Возвращает id администратора — от его имени пишется фикстура. */
export async function seedUsers(client: PoolClient): Promise<string> {
  const password = process.env.SEED_PASSWORD ?? 'nodus';
  let adminId = '';

  for (const [email, name, role] of SEED_USERS) {
    const hash = await hashPassword(password);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING id`,
      [email.toLowerCase(), name, hash, role],
    );
    if (role === 'admin') adminId = rows[0].id;
  }

  return adminId;
}
