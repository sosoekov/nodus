import type { FastifyInstance } from 'fastify';
import { pool } from '../db';
import { unauthorized } from '../errors';
import type { SessionUser } from '../types';
import { verifyPassword } from './password';

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const { rows } = await pool.query<SessionUser & { password_hash: string }>(
        'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
        [email],
      );

      const user = rows[0];
      const hash = user?.password_hash ?? 'scrypt$16384$8$1$AAAA$AAAA';
      const ok = await verifyPassword(request.body.password, hash);

      if (!user || !ok) throw unauthorized('Неверный email или пароль');

      app.issueSession(reply, user.id);
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    app.clearSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    if (!request.currentUser) throw unauthorized();
    return request.currentUser;
  });
}
