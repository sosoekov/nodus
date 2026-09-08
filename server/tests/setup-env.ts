import { TEST_DATABASE_URL, TEST_SESSION_SECRET } from './env';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.LOG_LEVEL = 'silent';
