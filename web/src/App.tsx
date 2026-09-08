import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { useAuth } from './auth/AuthContext';
import { Button, Spinner } from './components/ui';
import { GraphProvider } from './graph/store';
import { DictionaryProvider } from './hooks/useDictionaries';
import { LiveProvider, useLive } from './hooks/useLiveChanges';
import { BulkImportPage } from './pages/BulkImportPage';
import { LocalGraphPage } from './pages/LocalGraphPage';
import { MechanismEditorPage } from './pages/MechanismEditorPage';
import { ObjectCardPage } from './pages/ObjectCardPage';
import { SearchPage } from './pages/SearchPage';

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="Проверяем сессию…" />;
  if (!user) return <LoginPage />;

  return (
    <DictionaryProvider>
      <LiveProvider>
        <GraphProvider>
          <div className="flex min-h-full flex-col">
          <TopBar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<SearchPage />} />
              <Route path="/objects/bulk" element={<BulkImportPage />} />
              <Route path="/objects/:id" element={<ObjectCardPage />} />
              <Route path="/mechanisms/new" element={<MechanismEditorPage />} />
              <Route path="/mechanisms/:id" element={<MechanismEditorPage />} />
              <Route path="/graph/:id" element={<LocalGraphPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          </div>
        </GraphProvider>
      </LiveProvider>
    </DictionaryProvider>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const location = useLocation();

  return (
    <header className="flex items-center gap-3 border-b border-[var(--color-line)] bg-white px-4 py-2">
      <Link to="/" className="text-sm font-semibold">
        Nodus
      </Link>

      {location.pathname !== '/' ? (
        <Link to="/" className="text-sm text-[var(--color-muted)] hover:underline">
          поиск
        </Link>
      ) : null}

      <span
        className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-muted)]"
        title={
          connected
            ? 'Правки коллег приходят сразу'
            : 'Связь потеряна — переподключаемся, правки догрузятся'
        }
      >
        <span
          className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
          aria-hidden
        />
        {connected ? 'на связи' : 'нет связи'}
      </span>

      <span className="text-xs text-[var(--color-muted)]">
        {user?.name} · {user?.role}
      </span>
      <Button variant="ghost" onClick={() => void logout()}>
        выйти
      </Button>
    </header>
  );
}
