import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { ObjectCard, ObjectStatus } from '../api/types';
import { LockBanner } from '../components/LockBanner';
import {
  Button,
  ErrorNote,
  Field,
  Markdown,
  Spinner,
  StatusBadge,
  TypeBadge,
  inputClass,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useDictionaries } from '../hooks/useDictionaries';
import { useLock } from '../hooks/useLock';
import { useOnChange } from '../hooks/useLiveChanges';

const DIRECTION_HINT: Record<string, string> = {
  source: 'объект влияет на результат',
  target: 'в объект попадает результат',
  neutral: 'объект участвует',
};

export function ObjectCardPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { object_types } = useDictionaries();

  const [card, setCard] = useState<ObjectCard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCard(await api.get<ObjectCard>(`/api/objects/${id}`));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }, [id]);

  useEffect(() => {
    setCard(null);
    setEditing(false);
    void load();
  }, [load]);

  // Правка коллеги по этому объекту или по механизму, где он участвует.
  useOnChange((event) => {
    if (event.entity_id === id || event.entity_type !== 'object') void load();
  });

  const lock = useLock('object', id, editing);

  if (error) {
    return (
      <div className="p-6">
        <ErrorNote error={error} />
        <Button className="mt-3" onClick={() => navigate('/')}>
          К поиску
        </Button>
      </div>
    );
  }

  if (!card) return <Spinner />;

  const { object, parent, children, mechanisms_by_role } = card;

  return (
    <div className="mx-auto flex max-w-5xl gap-6 p-6">
      <div className="min-w-0 flex-1 space-y-5">
        <header>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <TypeBadge code={object.type_code} />
            <StatusBadge status={object.status} />
            {parent ? (
              <span className="text-xs text-[var(--color-muted)]">
                реквизит{' '}
                <Link className="underline" to={`/objects/${parent.id}`}>
                  {parent.full_name ?? parent.name}
                </Link>
              </span>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold">{object.name}</h1>
          {object.full_name ? (
            <p className="text-sm text-[var(--color-muted)]">{object.full_name}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {object.subsystem ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{object.subsystem}</span>
            ) : null}
            {object.tags.map((tag) => (
              <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {tag}
              </span>
            ))}
          </div>
        </header>

        {editing ? (
          <>
            <LockBanner state={lock.state} onTakeOver={() => void lock.takeOver()} />
            <ObjectForm
              card={card}
              types={object_types.map((type) => type.code)}
              readOnly={lock.state.kind === 'taken'}
              onCancel={() => setEditing(false)}
              onSaved={async () => {
                setEditing(false);
                await load();
              }}
            />
          </>
        ) : (
          <section>
            <h2 className="mb-1.5 text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
              Описание
            </h2>
            <Markdown>{object.description}</Markdown>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => navigate(`/graph/${object.id}`)}>
                Локальный граф
              </Button>
              {can('editor') ? <Button onClick={() => setEditing(true)}>Редактировать</Button> : null}
            </div>
          </section>
        )}

        {children.length ? (
          <section>
            <h2 className="mb-1.5 text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
              Реквизиты
            </h2>
            <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded border border-[var(--color-line)] bg-white">
              {children.map((child) => (
                <li key={child.id}>
                  <Link
                    to={`/objects/${child.id}`}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                  >
                    <TypeBadge code={child.type_code} />
                    <span className="truncate text-sm">{child.name}</span>
                    <StatusBadge status={child.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2 className="mb-1.5 text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Механизмы по ролям
          </h2>

          {mechanisms_by_role.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-muted)]">
              Объект пока ни в чем не участвует. Заведите механизм и добавьте его в состав.
            </p>
          ) : (
            <div className="space-y-3">
              {mechanisms_by_role.map((group) => (
                <div
                  key={group.role_code}
                  className="overflow-hidden rounded border border-[var(--color-line)] bg-white"
                >
                  <div className="flex items-baseline gap-2 border-b border-[var(--color-line)] bg-slate-50 px-3 py-1.5">
                    <span className="text-sm font-medium">{group.role_title}</span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {DIRECTION_HINT[group.direction]}
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--color-line)]">
                    {group.mechanisms.map((mechanism) => (
                      <li key={mechanism.id}>
                        <Link
                          to={`/mechanisms/${mechanism.id}`}
                          className="block px-3 py-2 hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2">
                            <span className="flex-1 truncate text-sm">{mechanism.title}</span>
                            <StatusBadge status={mechanism.status} />
                          </span>
                          {mechanism.summary ? (
                            <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                              {mechanism.summary}
                            </span>
                          ) : null}
                          {mechanism.note ? (
                            <span className="mt-0.5 block text-xs text-slate-600 italic">
                              {mechanism.note}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ObjectForm({
  card,
  types,
  readOnly,
  onCancel,
  onSaved,
}: {
  card: ObjectCard;
  types: string[];
  /** Блокировку держит другой — поля закрыты, как обещает баннер над формой. */
  readOnly: boolean;
  onCancel(): void;
  onSaved(): Promise<void>;
}) {
  const { object } = card;
  const [form, setForm] = useState({
    name: object.name,
    full_name: object.full_name ?? '',
    type_code: object.type_code,
    subsystem: object.subsystem ?? '',
    tags: object.tags.join(', '),
    description: object.description ?? '',
    status: object.status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{ version: number } | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      await api.patch(`/api/objects/${object.id}`, {
        version: object.version,
        name: form.name,
        full_name: form.full_name || null,
        type_code: form.type_code,
        subsystem: form.subsystem || null,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        description: form.description || null,
        status: form.status,
      });
      await onSaved();
    } catch (caught) {
      // Кто-то сохранил раньше: показываем это отдельно от обычной ошибки,
      // потому что лечится оно перезагрузкой, а не повтором.
      if (caught instanceof ApiError && caught.isConflict) {
        const details = caught.details as { current?: { version: number } };
        setConflict(details?.current ?? null);
      } else {
        setError(caught);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded border border-[var(--color-line)] bg-white p-4">
      <ErrorNote error={error} />

      {conflict ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Объект успели изменить (версия {conflict.version}, у вас {object.version}). Обновите
          карточку и перенесите правку заново, иначе затрете чужое.
          <Button className="mt-2" onClick={() => void onSaved()}>
            Обновить карточку
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Имя">
          <input
            className={inputClass}
            disabled={readOnly}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Полное имя">
          <input
            className={inputClass}
            disabled={readOnly}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </Field>
        <Field label="Тип">
          <select
            className={inputClass}
            disabled={readOnly}
            value={form.type_code}
            onChange={(e) => setForm({ ...form, type_code: e.target.value })}
          >
            {types.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Статус">
          <select
            className={inputClass}
            disabled={readOnly}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ObjectStatus })}
          >
            <option value="stub">заглушка</option>
            <option value="active">активен</option>
            <option value="deprecated">устарел</option>
          </select>
        </Field>
        <Field label="Подсистема">
          <input
            className={inputClass}
            disabled={readOnly}
            value={form.subsystem}
            onChange={(e) => setForm({ ...form, subsystem: e.target.value })}
          />
        </Field>
        <Field label="Теги" hint="через запятую">
          <input
            className={inputClass}
            disabled={readOnly}
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Описание" hint="markdown">
        <textarea
          className={`${inputClass} min-h-40 font-mono text-xs`}
          disabled={readOnly}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

      {form.description.trim() ? (
        <div className="rounded border border-[var(--color-line)] bg-slate-50 p-3">
          <p className="mb-1 text-xs text-[var(--color-muted)]">Превью</p>
          <Markdown>{form.description}</Markdown>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button variant="primary" disabled={saving || readOnly} onClick={() => void save()}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Button onClick={onCancel}>Отмена</Button>
      </div>
    </section>
  );
}
