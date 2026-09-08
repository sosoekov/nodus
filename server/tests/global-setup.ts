import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './env';

const run = promisify(execFile);

async function ensureDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  await ensureDatabase();

  await run('npx', ['node-pg-migrate', '-m', 'migrations', 'up'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, VERBOSE: 'false' },
  });
}
