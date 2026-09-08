import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorNote, Spinner } from '../components/ui';
import { DetailPanel } from '../graph/DetailPanel';
import { GraphView } from '../graph/GraphView';
import { buildGraph } from '../graph/build';
import { useGraphStore } from '../graph/store';
import type { RenderMode, Selection } from '../graph/types';
import { useDictionaries } from '../hooks/useDictionaries';

const selectClass =
  'rounded border border-[var(--color-line)] bg-white px-2 py-1 text-sm outline-none focus:border-blue-500';

export function FullGraphPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { typeByCode, object_types } = useDictionaries();
  const { state, loading, error, reload } = useGraphStore();

  const [mode, setMode] = useState<RenderMode>('objects');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [tag, setTag] = useState('');
  const [recomputing, setRecomputing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const subsystems = useMemo(() => {
    if (!state) return [];
    return [...new Set([...state.objects.values()].map((o) => o.subsystem).filter(Boolean))].sort();
  }, [state]);

  const tags = useMemo(() => {
    if (!state) return [];
    return [...new Set([...state.objects.values()].flatMap((o) => o.tags))].sort();
  }, [state]);

  const visible = useMemo(() => {
    if (!state) return new Set<string>();
    if (!type && !status && !subsystem && !tag) return undefined as unknown as Set<string>;

    const result = new Set<string>();
    for (const object of state.objects.values()) {
      if (type && object.type_code !== type) continue;
      if (status && object.status !== status) continue;
      if (subsystem && object.subsystem !== subsystem) continue;
      if (tag && !object.tags.includes(tag)) continue;
      result.add(object.id);
    }
    return result;
  }, [state, type, status, subsystem, tag]);

  const graph = useMemo(() => {
    if (!state) return null;
    return buildGraph(state, typeByCode, { mode, expanded, visibleObjects: visible });
  }, [state, typeByCode, mode, expanded, visible]);

  // Раскладка берется из базы. Пересчитывать ее при каждой загрузке нельзя: на
  // 1000+ узлов это долго, и картинка каждый раз получается разной.
  const hasStoredLayout = useMemo(() => {
    if (!state) return false;
    for (const object of state.objects.values()) if (object.x !== null) return true;
    return false;
  }, [state]);

  const saveposition = useCallback(
    async (node: string, x: number, y: number) => {
      if (!state?.objects.has(node)) return; // узел-механизм координат не хранит
      try {
        await api.put('/api/layout', { positions: [{ object_id: node, x, y, pinned: true }] });
      } catch (caught) {
        console.error(caught);
      }
    },
    [state],
  );

  const recompute = async () => {
    setRecomputing(true);
    setNote(null);
    try {
      const result = await api.post<{ nodes: number; pinned: number }>('/api/layout/recompute');
      await reload();
      setNote(`Раскладка пересчитана: ${result.nodes} узлов, закреплено ${result.pinned}.`);
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : 'Не удалось пересчитать');
    } finally {
      setRecomputing(false);
    }
  };

  if (loading && !state) return <Spinner label="Загружаем граф…" />;
  if (error) return <ErrorNote error={error} />;
  if (!state || !graph) return <Spinner />;

  const filtersOn = Boolean(type || status || subsystem || tag);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] bg-white px-4 py-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">Полный граф</h1>
          <p className="text-xs text-[var(--color-muted)]">
            узлов {graph.order} · связей {graph.size}
            {filtersOn ? ' · с фильтрами' : ''}
          </p>
        </div>

        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">все типы</option>
          {object_types.map((item) => (
            <option key={item.code} value={item.code}>
              {item.title}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={subsystem}
          onChange={(e) => setSubsystem(e.target.value)}
        >
          <option value="">все подсистемы</option>
          {subsystems.map((item) => (
            <option key={item} value={item!}>
              {item}
            </option>
          ))}
        </select>

        <select className={selectClass} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">все теги</option>
          {tags.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">любой статус</option>
          <option value="stub">заглушка</option>
          <option value="active">активен</option>
          <option value="deprecated">устарел</option>
        </select>

        {filtersOn ? (
          <Button
            variant="ghost"
            onClick={() => {
              setType('');
              setStatus('');
              setSubsystem('');
              setTag('');
            }}
          >
            сбросить
          </Button>
        ) : null}

        <Button onClick={() => setMode(mode === 'objects' ? 'full' : 'objects')}>
          {mode === 'objects' ? 'Показать механизмы' : 'Скрыть механизмы'}
        </Button>

        <Button onClick={() => setExpanded(expanded.size ? new Set() : allParents(state))}>
          {expanded.size ? 'Свернуть реквизиты' : 'Развернуть реквизиты'}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => navigate('/paths')}>Пути</Button>
          {can('admin') ? (
            <Button variant="primary" disabled={recomputing} onClick={() => void recompute()}>
              {recomputing ? 'Считаем…' : 'Пересчитать раскладку'}
            </Button>
          ) : null}
        </div>
      </div>

      {note ? (
        <p className="border-b border-[var(--color-line)] bg-blue-50 px-4 py-1.5 text-xs text-blue-900">
          {note}
        </p>
      ) : null}

      {!hasStoredLayout ? (
        <p className="border-b border-[var(--color-line)] bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          Раскладка еще не считалась — узлы расставлены по кругу.
          {can('admin')
            ? ' Нажмите «Пересчитать раскладку».'
            : ' Попросите администратора нажать «Пересчитать раскладку».'}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphView
            key={`${mode}-${expanded.size}-${type}-${status}-${subsystem}-${tag}-${hasStoredLayout}`}
            graph={graph}
            // Раскладку считаем на лету, только пока ее нет в базе.
            runLayout={!hasStoredLayout}
            onSelect={setSelection}
            onMoveNode={can('editor') ? (node, x, y) => void saveposition(node, x, y) : undefined}
          />
        </div>

        <DetailPanel
          selection={selection}
          onClose={() => setSelection(null)}
          onFocusObject={(objectId) => navigate(`/graph/${objectId}`)}
        />
      </div>
    </div>
  );
}

/** Объекты, у которых есть хотя бы один реквизит. */
function allParents(state: { objects: Map<string, { parent_id: string | null }> }): Set<string> {
  const parents = new Set<string>();
  for (const object of state.objects.values()) {
    if (object.parent_id) parents.add(object.parent_id);
  }
  return parents;
}
