import { formatDate, formatExact, formatRelative } from '../lib/dates';

interface Props {
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Автор и даты — одной строкой в подвале карточки, а не полями формы: они не
 * редактируются, и лейбл с инпутом на каждое из них съел бы четыре строки
 * ради трех фактов.
 *
 * Точное время — в тултипе: относительное читается быстрее, но иногда нужна
 * секунда, особенно когда двое правят одну запись.
 */
export function MetaFooter({ authorName, createdAt, updatedAt }: Props) {
  // Правка в ту же секунду, что и создание, — это и есть создание.
  const wasEdited = new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 1000;

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-muted)]">
      {authorName ? <span title="Кто завел запись">{authorName}</span> : null}
      {authorName ? <span aria-hidden>·</span> : null}

      <span title={formatExact(createdAt)}>создан {formatDate(createdAt)}</span>

      {wasEdited ? (
        <>
          <span aria-hidden>·</span>
          <span title={formatExact(updatedAt)}>изменен {formatRelative(updatedAt)}</span>
        </>
      ) : null}
    </p>
  );
}
