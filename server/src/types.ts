export type Role = 'viewer' | 'editor' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: SessionUser | null;
  }
}
