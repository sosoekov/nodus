import { useState } from 'react';
import { Button, ErrorNote, Field, inputClass } from '../components/ui';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded border border-[var(--color-line)] bg-white p-6"
      >
        <h1 className="text-lg font-semibold">Nodus</h1>
        <p className="text-sm text-[var(--color-muted)]">Граф связей объектов конфигурации</p>

        <ErrorNote error={error} />

        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Пароль">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !email || !password}
          onClick={(event) => void submit(event)}
        >
          {busy ? 'Входим…' : 'Войти'}
        </Button>
      </form>
    </div>
  );
}
