function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://nodus:nodus@localhost:5432/nodus'),
  sessionSecret: required('SESSION_SECRET', 'nodus-dev-secret-change-me-please-32-chars'),
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  cookieName: 'nodus_session',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 14),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** Клиент шлет heartbeat раз в 15 секунд, протухание — через 60. */
  lockTtlSeconds: Number(process.env.LOCK_TTL_SECONDS ?? 60),
  /** Комментарий-пинг в SSE, чтобы прокси не рвали молчащее соединение. */
  sseHeartbeatMs: Number(process.env.SSE_HEARTBEAT_MS ?? 25_000),
  /** Через сколько EventSource переподключается после обрыва. */
  sseRetryMs: Number(process.env.SSE_RETRY_MS ?? 3_000),
};

export type Config = typeof config;
