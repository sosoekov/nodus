import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type {
  Mechanism,
  MechanismCard,
  MechanismStatus,
  ParticipantInput,
} from '../api/types';
import { LockBanner } from '../components/LockBanner';
import { MetaFooter } from '../components/MetaFooter';
import { ParticipantsTable, type ParticipantRow } from '../components/ParticipantsTable';
import {
  Button,
  ErrorNote,
  Field,
  Markdown,
  Spinner,
  StatusBadge,
  inputClass,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useDictionaries } from '../hooks/useDictionaries';
import { useLock } from '../hooks/useLock';
import { useOnChange } from '../hooks/useLiveChanges';
import { MECHANISM_TEMPLATES, type MechanismTemplate } from '../lib/templates';

/** Строка таблицы участников. Объект может быть еще не выбран — это шаблон. */
type Row = ParticipantRow;

let rowCounter = 0;
const newKey = () => `row-${(rowCounter += 1)}`;

export function MechanismEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { can } = useAuth();
  const { mechanism_categories, participant_roles, roleByCode } = useDictionaries();

  const [mechanism, setMechanism] = useState<Mechanism | null>(null);
  const [form, setForm] = useState({
    title: '',
    category_code: '',
    summary: '',
    body: '',
    status: 'draft' as MechanismStatus,
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{ version: number } | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [staleWarning, setStaleWarning] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const card = await api.get<MechanismCard>(`/api/mechanisms/${id}`);
    setMechanism(card.mechanism);
    setForm({
      title: card.mechanism.title,
      category_code: card.mechanism.category_code,
      summary: card.mechanism.summary ?? '',
      body: card.mechanism.body ?? '',
      status: card.mechanism.status,
    });
    setRows(
      card.participants.map((participant) => ({
        key: newKey(),
        object: {
          id: participant.object_id,
          name: participant.name,
          full_name: participant.full_name,
          type_code: participant.type_code,
        },
        role_code: participant.role_code,
        note: participant.note ?? '',
      })),
    );
    setStaleWarning(false);
  }, [id]);

  useEffect(() => {
    if (isNew) {
      setForm((current) => ({
        ...current,
        category_code: current.category_code || (mechanism_categories[0]?.code ?? ''),
      }));
      return;
    }
    setLoading(true);
    void load()
      .catch(setError)
      .finally(() => setLoading(false));
  }, [isNew, load, mechanism_categories]);

  // Не перезатираем несохраненную правку чужим патчем — только предупреждаем.
  useOnChange((event) => {
    if (!id) return;
    if (event.entity_type === 'mechanism' && event.entity_id === id) setStaleWarning(true);
    if (event.entity_type === 'participant') setStaleWarning(true);
  });

  const lock = useLock('mechanism', id ?? null, !isNew && can('editor'));

  // Пока блокировку держит кто-то другой, поля закрыты — ровно то, что обещает
  // баннер. «Все равно редактировать» переводит блокировку на себя и открывает
  // их. Состояние `lost` (блокировку увели, пока мы печатали) полей не запирает:
  // набранное уже есть, и отнимать возможность его сохранить было бы хуже.
  const readOnly = !can('editor') || lock.state.kind === 'taken';

  const applyTemplate = (template: MechanismTemplate) => {
    setForm((current) => ({
      ...current,
      title: current.title || template.title,
      category_code: template.category_code,
      summary: current.summary || template.summary,
      body: current.body || template.body,
    }));
    setRows(
      template.slots.map((slot) => ({
        key: newKey(),
        object: null,
        role_code: slot.role_code,
        note: slot.note,
      })),
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setConflict(null);

    try {
      if (isNew) {
        const created = await api.post<Mechanism>('/api/mechanisms', {
          title: form.title,
          category_code: form.category_code,
          summary: form.summary || null,
          body: form.body || null,
          status: form.status,
        });
        // Состав ставим вторым запросом: id механизма появляется только сейчас.
        const filled = participantsPayload(rows);
        if (filled.length) {
          await api.put(`/api/mechanisms/${created.id}/participants`, {
            version: created.version,
            participants: filled,
          });
        }
        navigate(`/mechanisms/${created.id}`, { replace: true });
        return;
      }

      if (!mechanism) return;

      const updated = await api.patch<Mechanism>(`/api/mechanisms/${mechanism.id}`, {
        version: mechanism.version,
        title: form.title,
        category_code: form.category_code,
        summary: form.summary || null,
        body: form.body || null,
        status: form.status,
      });

      await api.put(`/api/mechanisms/${mechanism.id}/participants`, {
        version: updated.version,
        participants: participantsPayload(rows),
      });

      await load();
    } catch (caught) {
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

  const remove = async () => {
    if (!mechanism) return;
    if (!confirm(`Удалить механизм «${mechanism.title}»? Это мягкое удаление.`)) return;
    try {
      await api.del(`/api/mechanisms/${mechanism.id}?version=${mechanism.version}`);
      navigate('/');
    } catch (caught) {
      setError(caught);
    }
  };

  if (loading) return <Spinner />;

  const incomplete = rows.filter((row) => !row.object).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {isNew ? 'Новый механизм' : (mechanism?.title ?? '')}
        </h1>
        {mechanism ? <StatusBadge status={mechanism.status} /> : null}
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          {mechanism ? `версия ${mechanism.version}` : ''}
        </span>
      </header>

      {!isNew ? <LockBanner state={lock.state} onTakeOver={() => void lock.takeOver()} /> : null}

      {staleWarning ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Механизм изменили в другой вкладке. Ваши несохраненные правки на месте.
          <Button className="ml-auto" onClick={() => void load()}>
            Перечитать
          </Button>
        </div>
      ) : null}

      <ErrorNote error={error} />

      {conflict ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Механизм успели изменить (версия {conflict.version}, у вас {mechanism?.version}).
          Перечитайте и перенесите правку — иначе затрете чужую.
          <Button className="mt-2" onClick={() => void load()}>
            Перечитать
          </Button>
        </div>
      ) : null}

      {isNew ? (
        <section className="rounded border border-[var(--color-line)] bg-white p-4">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Начать с шаблона
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {MECHANISM_TEMPLATES.map((template) => (
              <button
                key={template.code}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded border border-[var(--color-line)] p-2.5 text-left hover:border-blue-400 hover:bg-blue-50"
              >
                <span className="block text-sm font-medium">{template.title}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                  {template.hint}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Шаблон расставит роли участников — останется подставить объекты.
          </p>
        </section>
      ) : null}

      <section className="space-y-3 rounded border border-[var(--color-line)] bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Заголовок">
            <input
              className={inputClass}
              disabled={readOnly}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Категория">
            <select
              className={inputClass}
              disabled={readOnly}
              value={form.category_code}
              onChange={(e) => setForm({ ...form, category_code: e.target.value })}
            >
              {mechanism_categories.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Краткое описание"
          hint={`показывается на ховере в графе · ${form.summary.length}/200`}
        >
          <input
            className={inputClass}
            maxLength={200}
            disabled={readOnly}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </Field>

        <Field label="Статус">
          <select
            className={`${inputClass} sm:w-48`}
            disabled={readOnly}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as MechanismStatus })}
          >
            <option value="draft">черновик</option>
            <option value="active">активен</option>
            <option value="deprecated">устарел</option>
          </select>
        </Field>
      </section>

      <section className="rounded border border-[var(--color-line)] bg-white p-4">
        <div className="mb-2 flex items-center">
          <h2 className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Подробное описание
          </h2>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? 'скрыть превью' : 'показать превью'}
          </Button>
        </div>

        <div className={showPreview ? 'grid gap-3 lg:grid-cols-2' : ''}>
          <textarea
            className={`${inputClass} min-h-64 font-mono text-xs`}
            disabled={readOnly}
            placeholder="Откуда берется значение, что его перебивает, куда попадает результат…"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          {showPreview ? (
            <div className="min-h-64 overflow-auto rounded border border-[var(--color-line)] bg-slate-50 p-3">
              <Markdown>{form.body}</Markdown>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded border border-[var(--color-line)] bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Участники
          </h2>
          {incomplete ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              не выбран объект: {incomplete}
            </span>
          ) : null}
          <Button
            className="ml-auto"
            disabled={readOnly}
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  key: newKey(),
                  object: null,
                  role_code: participant_roles[0]?.code ?? '',
                  note: '',
                },
              ])
            }
          >
            Добавить участника
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-muted)]">
            Пока никого. Механизм без участников — это просто заметка: он не попадет в граф.
          </p>
        ) : null}

        <ParticipantsTable
          rows={rows}
          roles={participant_roles}
          roleByCode={roleByCode}
          readOnly={readOnly}
          onChange={setRows}
        />
      </section>

      {mechanism ? (
        <MetaFooter
          authorName={mechanism.author_name}
          createdAt={mechanism.created_at}
          updatedAt={mechanism.updated_at}
        />
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={readOnly || saving || !form.title.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Button onClick={() => navigate(-1)}>Назад</Button>
        {!isNew && can('editor') ? (
          <Button variant="danger" className="ml-auto" onClick={() => void remove()}>
            Удалить
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Строки без выбранного объекта в состав не идут — это незаполненные заготовки. */
function participantsPayload(rows: Row[]): ParticipantInput[] {
  return rows
    .filter((row) => row.object)
    .map((row, index) => ({
      object_id: row.object!.id,
      role_code: row.role_code,
      note: row.note || null,
      sort_order: index * 10,
    }));
}
