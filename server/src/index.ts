import { buildApp } from './app';
import { config } from './config';
import { pool } from './db';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
