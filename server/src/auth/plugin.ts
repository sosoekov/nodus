import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config';
import { pool } from '../db';
import { forbidden, unauthorized } from '../errors';
import { ROLE_RANK, type Role, type SessionUser } from '../types';

interface SessionPayload {
  uid: string;
  iat: number;
}

function encodeSession(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSession(raw: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.uid !== 'string' || typeof parsed?.iat !== 'number') return null;
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

async function loadUser(userId: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<SessionUser>(
    'SELECT id, email, name, role FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cookie, { secret: config.sessionSecret });

  app.decorateRequest('currentUser', null);

  app.decorate('issueSession', (reply: FastifyReply, userId: string) => {
    reply.setCookie(config.cookieName, encodeSession({ uid: userId, iat: Date.now() }), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      signed: true,
      maxAge: config.sessionTtlSeconds,
    });
  });

  app.decorate('clearSession', (reply: FastifyReply) => {
    reply.clearCookie(config.cookieName, { path: '/' });
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const raw = request.cookies[config.cookieName];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const payload = decodeSession(unsigned.value);
    if (!payload) return;

    if (Date.now() - payload.iat > config.sessionTtlSeconds * 1000) return;

    request.currentUser = await loadUser(payload.uid);
  });

  app.decorate('requireRole', (minimal: Role) => {
    return async (request: FastifyRequest) => {
      if (!request.currentUser) throw unauthorized();
      if (ROLE_RANK[request.currentUser.role] < ROLE_RANK[minimal]) throw forbidden();
    };
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    issueSession(reply: FastifyReply, userId: string): void;
    clearSession(reply: FastifyReply): void;
    requireRole(minimal: Role): (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(authPlugin, { name: 'auth' });
