import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { MechanismCard, ObjectCard } from '../api/types';
import { Button, Markdown, Spinner, StatusBadge, TypeBadge } from '../components/ui';
import { useDictionaries } from '../hooks/useDictionaries';
import type { Selection } from './types';

/**
 * Панель с полным описанием. Тяжелое содержимое (description объекта, body
 * механизма) в снапшот не входит, поэтому подгружается здесь по клику.
 */
export function DetailPanel({
  selection,
  onClose,
  onFocusObject,
}: {
  selection: Selection;
  onClose(): void;
  onFocusObject?(id: string): void;
}) {
  if (!selection) {
    return (
      <aside className="flex h-full w-80 shrink-0 items-center border-l border-[var(--color-line)] bg-white p-4">
        <p className="text-sm text-[var(--color-muted)]">
          Наведите на узел, чтобы увидеть его связи. Клик закрепит подсветку и покажет описание,
          клик по пустому месту снимет.
        </p>
      </aside>
    );
  }

  return (
    <aside className="h-full w-80 shrink-0 overflow-y-auto border-l border-[var(--color-line)] bg-white">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
        <span className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
          {selection.kind === 'object' ? 'Объект' : 'Механизм'}
          {selection.kind === 'edge' && selection.mechanismIds.length > 1 ? 'ы' : ''}
        </span>
        <Button variant="ghost" className="ml-auto px-1.5 py-0.5" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className="p-3">
        {selection.kind === 'object' ? (
          <ObjectDetail id={selection.id} onFocusObject={onFocusObject} />
        ) : selection.kind === 'mechanism' ? (
          <MechanismDetail id={selection.id} onFocusObject={onFocusObject} />
        ) : (
          <div className="space-y-4">
            {selection.mechanismIds.map((id) => (
              <MechanismDetail key={id} id={id} onFocusObject={onFocusObject} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ObjectDetail({ id, onFocusObject }: { id: string; onFocusObject?(id: string): void }) {
  const [card, setCard] = useState<ObjectCard | null>(null);

  useEffect(() => {
    setCard(null);
    void api.get<ObjectCard>(`/api/objects/${id}`).then(setCard).catch(console.error);
  }, [id]);

  if (!card) return <Spinner />;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <TypeBadge code={card.object.type_code} />
          <StatusBadge status={card.object.status} />
        </div>
        <h3 className="text-sm font-semibold">{card.object.name}</h3>
        {card.object.full_name ? (
          <p className="text-xs break-all text-[var(--color-muted)]">{card.object.full_name}</p>
        ) : null}
      </div>

      <Markdown>{card.object.description}</Markdown>

      {card.mechanisms_by_role.map((group) => (
        <div key={group.role_code}>
          <p className="text-xs font-medium text-[var(--color-muted)]">{group.role_title}</p>
          <ul className="mt-0.5 space-y-0.5">
            {group.mechanisms.map((mechanism) => (
              <li key={mechanism.id} className="text-sm">
                {mechanism.title}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          to={`/objects/${id}`}
          className="rounded border border-[var(--color-line)] px-2.5 py-1 text-sm hover:bg-slate-50"
        >
          Карточка
        </Link>
        {onFocusObject ? (
          <Button onClick={() => onFocusObject(id)}>Локальный граф</Button>
        ) : null}
      </div>
    </div>
  );
}

function MechanismDetail({ id, onFocusObject }: { id: string; onFocusObject?(id: string): void }) {
  const { categoryByCode } = useDictionaries();
  const [card, setCard] = useState<MechanismCard | null>(null);

  useEffect(() => {
    setCard(null);
    void api.get<MechanismCard>(`/api/mechanisms/${id}`).then(setCard).catch(console.error);
  }, [id]);

  if (!card) return <Spinner />;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {categoryByCode.get(card.mechanism.category_code)?.title ?? card.mechanism.category_code}
          </span>
          <StatusBadge status={card.mechanism.status} />
        </div>
        <h3 className="text-sm font-semibold">{card.mechanism.title}</h3>
        {card.mechanism.summary ? (
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{card.mechanism.summary}</p>
        ) : null}
      </div>

      <Markdown>{card.mechanism.body}</Markdown>

      <div>
        <p className="mb-1 text-xs font-medium text-[var(--color-muted)]">Участники</p>
        <ul className="space-y-1">
          {card.participants.map((participant) => (
            <li key={participant.id} className="text-sm">
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onFocusObject?.(participant.object_id)}
              >
                <span className="flex items-center gap-1.5">
                  <TypeBadge code={participant.type_code} />
                  <span className="truncate">{participant.full_name ?? participant.name}</span>
                </span>
              </button>
              <span className="block text-xs text-[var(--color-muted)]">
                {participant.role_title}
                {participant.note ? ` — ${participant.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        to={`/mechanisms/${id}`}
        className="inline-block rounded border border-[var(--color-line)] px-2.5 py-1 text-sm hover:bg-slate-50"
      >
        Открыть механизм
      </Link>
    </div>
  );
}
