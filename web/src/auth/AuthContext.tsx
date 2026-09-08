import { createContext, type ReactNode, use, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** viewer < editor < admin */
  can(minimal: Role): boolean;
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<User>('/api/auth/me')
      .then(setUser)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError && error.isUnauthorized)) console.error(error);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.post<User>('/api/auth/login', { email, password }));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  const can = useCallback(
    (minimal: Role) => Boolean(user && RANK[user.role] >= RANK[minimal]),
    [user],
  );

  return <AuthContext value={{ user, loading, login, logout, can }}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth вне AuthProvider');
  return context;
}
