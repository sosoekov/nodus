import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useDictionaries } from '../hooks/useDictionaries';
import type { MechanismStatus, ObjectStatus } from '../api/types';

export function TypeBadge({ code }: { code: string }) {
  const { typeByCode } = useDictionaries();
  const type = typeByCode.get(code);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs whitespace-nowrap"
      style={{
        background: `${type?.color ?? '#9aa5b1'}1a`,
        color: type?.color ?? '#6b7785',
      }}
    >
      <span
        className="size-2 rounded-full"
        style={{ background: type?.color ?? '#9aa5b1' }}
        aria-hidden
      />
      {type?.title ?? code}
    </span>
  );
}

const STATUS_LABELS: Record<ObjectStatus | MechanismStatus, { text: string; className: string }> = {
  stub: { text: 'заглушка', className: 'bg-amber-100 text-amber-800' },
  draft: { text: 'черновик', className: 'bg-amber-100 text-amber-800' },
  active: { text: 'активен', className: 'bg-emerald-100 text-emerald-800' },
  deprecated: { text: 'устарел', className: 'bg-slate-200 text-slate-600' },
};

export function StatusBadge({ status }: { status: ObjectStatus | MechanismStatus }) {
  const label = STATUS_LABELS[status];
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${label.className}`}>
      {label.text}
    </span>
  );
}

export function Markdown({ children }: { children: string | null | undefined }) {
  if (!children?.trim()) {
    return <p className="text-sm text-[var(--color-muted)] italic">Описание не заполнено</p>;
  }
  return (
    <div className="prose-nodus text-sm">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-sm ' +
  'outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
    secondary:
      'border border-[var(--color-line)] bg-white hover:bg-slate-50 disabled:text-slate-400',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
    ghost: 'text-[var(--color-muted)] hover:bg-slate-100',
  };

  return (
    <button
      type="button"
      {...props}
      className={`rounded px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  );
}

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return <p className="p-4 text-sm text-[var(--color-muted)]">{label}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
