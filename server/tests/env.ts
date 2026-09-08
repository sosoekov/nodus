export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://nodus:nodus@localhost:5432/nodus_test';

export const TEST_SESSION_SECRET = 'test-secret-not-used-outside-of-tests-0123456789';
