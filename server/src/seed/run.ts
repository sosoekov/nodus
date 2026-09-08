import { pool, withTransaction } from '../db';
import { seedDictionaries } from './dictionaries';
import { seedFixture } from './fixture';
import { seedUsers } from './users';

async function main(): Promise<void> {
  await withTransaction(async (client) => {
    await seedDictionaries(client);
    const adminId = await seedUsers(client);
    await seedFixture(client, adminId);
  });

  console.log('Сид выполнен: справочники, пользователи, фикстура.');
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
