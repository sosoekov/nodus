import { useState } from 'react';
import type { ParticipantRole } from '../api/types';
import { ObjectPicker } from './ObjectPicker';
import { TypeBadge } from './ui';

export interface ParticipantRow {
  key: string;
  object: { id: string; name: string; full_name: string | null; type_code: string } | null;
  role_code: string;
  note: string;
}

interface Props {
  rows: ParticipantRow[];
  roles: ParticipantRole[];
  roleByCode: Map<string, ParticipantRole>;
  readOnly: boolean;
  onChange(rows: ParticipantRow[]): void;
}

type EditingCell = { key: string; field: 'object' | 'role' | 'note' } | null;

const DIRECTION_HINT: Record<string, string> = {
  source: 'влияет на результат',
  target: 'в него попадает результат',
  neutral: 'направление не задано',
};

/**
 * Состав механизма компактной таблицей: строка на участника вместо стека полей
 * с лейблами, который занимал четыре строки на каждого. Редактирование
 * инлайновое — ячейка превращается в поле по клику и схлопывается обратно.
 */
export function ParticipantsTable({ rows, roles, roleByCode, readOnly, onChange }: Props) {
  const [editing, setEditing] = useState<EditingCell>(null);

  const patch = (key: string, change: Partial<ParticipantRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const isEditing = (key: string, field: 'object' | 'role' | 'note') =>
    editing?.key === key && editing.field === field;

  const openCell = (key: string, field: 'object' | 'role' | 'note') => {
    if (readOnly) return;
    setEditing({ key, field });
  };

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-[var(--color-muted)]">
          <th className="w-[38%] pb-1 font-medium">Объект</th>
          <th className="w-[22%] pb-1 font-medium">Роль</th>
          <th className="pb-1 font-medium">Чем участвует</th>
          <th className="w-8" />
        </tr>
      </thead>

      <tbody>
        {rows.map((row) => {
          const role = roleByCode.get(row.role_code);

          return (
            <tr key={row.key} className="group border-t border-[var(--color-line)] align-top">
              <td className="py-1.5 pr-2">
                {isEditing(row.key, 'object') || !row.object ? (
                  <ObjectPicker
                    disabled={readOnly}
                    value={row.object}
                    onSelect={(object) => {
                      patch(row.key, { object });
                      setEditing(null);
                    }}
                    onClear={() => patch(row.key, { object: null })}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-50"
                    onClick={() => openCell(row.key, 'object')}
                    title={row.object.full_name ?? row.object.name}
                  >
                    <TypeBadge code={row.object.type_code} />
                    <span className="truncate">{row.object.full_name ?? row.object.name}</span>
                  </button>
                )}
              </td>

              <td className="py-1.5 pr-2">
                {isEditing(row.key, 'role') ? (
                  <select
                    autoFocus
                    className="w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-sm outline-none"
                    value={row.role_code}
                    onChange={(event) => patch(row.key, { role_code: event.target.value })}
                    onBlur={() => setEditing(null)}
                  >
                    {roles.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-50"
                    onClick={() => openCell(row.key, 'role')}
                    // Направление роли — в тултипе: вторая строка под ролью
                    // превращала бы «одну строку на участника» в две.
                    title={DIRECTION_HINT[role?.direction ?? 'neutral']}
                  >
                    <span className="block truncate">{role?.title ?? row.role_code}</span>
                  </button>
                )}
              </td>

              <td className="py-1.5 pr-2">
                {isEditing(row.key, 'note') ? (
                  <textarea
                    autoFocus
                    rows={2}
                    className="w-full rounded border border-blue-500 bg-white px-1.5 py-0.5 text-sm outline-none"
                    value={row.note}
                    placeholder="чем именно участвует"
                    onChange={(event) => patch(row.key, { note: event.target.value })}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="w-full rounded px-1 py-0.5 text-left hover:bg-slate-50"
                    onClick={() => openCell(row.key, 'note')}
                    // Усеченный текст целиком — в тултипе и при редактировании.
                    title={row.note || undefined}
                  >
                    <span
                      className={`block truncate ${row.note ? '' : 'text-[var(--color-muted)] italic'}`}
                    >
                      {row.note || 'не заполнено'}
                    </span>
                  </button>
                )}
              </td>

              <td className="py-1.5 text-right">
                {readOnly ? null : (
                  <button
                    type="button"
                    // Появляется по наведению: постоянный крестик в каждой
                    // строке тянет взгляд сильнее, чем сами данные.
                    className="rounded px-1 text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-700 focus:opacity-100"
                    title="Убрать участника"
                    onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          );
        })}

        {readOnly ? null : (
          <tr className="border-t border-[var(--color-line)]">
            <td colSpan={4} className="pt-1.5">
              <button
                type="button"
                className="w-full rounded border border-dashed border-[var(--color-line)] px-2 py-1.5 text-left text-sm text-[var(--color-muted)] hover:border-blue-400 hover:text-[var(--color-ink)]"
                onClick={() => {
                  const key = `row-${Date.now()}-${rows.length}`;
                  onChange([
                    ...rows,
                    { key, object: null, role_code: roles[0]?.code ?? '', note: '' },
                  ]);
                  setEditing({ key, field: 'object' });
                }}
              >
                + Добавить участника
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
