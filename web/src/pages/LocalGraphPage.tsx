import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ErrorNote, Spinner } from '../components/ui';
import { DetailPanel } from '../graph/DetailPanel';
import { GraphView } from '../graph/GraphView';
import { buildGraph, neighbourhood } from '../graph/build';
import { useGraphStore } from '../graph/store';
import type { RenderMode, Selection } from '../graph/types';
import { useDictionaries } from '../hooks/useDictionaries';

export function LocalGraphPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { typeByCode } = useDictionaries();
  const { state, loading, error } = useGraphStore();

  const [depth, setDepth] = useState(1);
  const [mode, setMode] = useState<RenderMode>('objects');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverEdge, setHoverEdge] = useState<{
    mechanismIds: string[];
    x: number;
    y: number;
  } | null>(null);

  const visible = useMemo(
    () => (state ? neighbourhood(state, id, depth) : new Set<string>()),
    [state, id, depth],
  );

  const graph = useMemo(() => {
    if (!state) return null;
    return buildGraph(state, typeByCode, { mode, expanded, visibleObjects: visible, rootId: id });
  }, [state, typeByCode, mode, expanded, visible, id]);

  // Реквизиты у корня и соседей: кнопка появляется, только если есть что разворачивать.
  const collapsible = useMemo(() => {
    if (!state) return 0;
    let count = 0;
    for (const objectId of visible) {
      const object = state.objects.get(objectId);
      if (object?.parent_id && visible.has(object.parent_id)) count += 1;
    }
    return count;
  }, [state, visible]);

  const allExpanded = expanded.size > 0;

  if (loading && !state) return <Spinner label="Загружаем граф…" />;
  if (error) return <ErrorNote error={error} />;
  if (!state || !graph) return <Spinner />;

  const root = state.objects.get(id);
  if (!root) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-muted)]">
          Объект не найден в графе — возможно, он удален.
        </p>
        <Button className="mt-3" onClick={() => navigate('/')}>
          К поиску
        </Button>
      </div>
    );
  }

  const hoveredTitles = hoverEdge?.mechanismIds
    .map((mechanismId) => state.mechanisms.get(mechanismId))
    .filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-white px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{root.name}</h1>
          <p className="truncate text-xs text-[var(--color-muted)]">
            локальный граф · узлов {graph.order} · связей {graph.size}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-muted)]">глубина</span>
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          />
          <span className="w-3 tabular-nums">{depth}</span>
        </label>

        {/* Одна кнопка, как в требованиях: объектный режим прячет механизмы,
            полный показывает их отдельными узлами. */}
        <Button onClick={() => setMode(mode === 'objects' ? 'full' : 'objects')}>
          {mode === 'objects' ? 'Показать механизмы' : 'Скрыть механизмы'}
        </Button>

        {collapsible ? (
          <Button
            onClick={() =>
              setExpanded(
                allExpanded
                  ? new Set()
                  : new Set(
                      [...visible].filter((objectId) =>
                        [...visible].some(
                          (other) => state.objects.get(other)?.parent_id === objectId,
                        ),
                      ),
                    ),
              )
            }
          >
            {allExpanded ? 'Свернуть реквизиты' : `Развернуть реквизиты (${collapsible})`}
          </Button>
        ) : null}

        <div className="ml-auto flex gap-2">
          <Button onClick={() => navigate(`/objects/${id}`)}>Карточка</Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphView
            key={`${id}-${mode}-${depth}-${expanded.size}`}
            graph={graph}
            runLayout
            onSelect={setSelection}
            onHoverEdge={setHoverEdge}
          />

          {hoverEdge && hoveredTitles?.length ? (
            <div
              className="pointer-events-none absolute z-10 max-w-xs rounded border border-[var(--color-line)] bg-white p-2 text-xs shadow-lg"
              style={{ left: hoverEdge.x + 12, top: hoverEdge.y + 12 }}
            >
              {hoveredTitles.map((mechanism) => (
                <div key={mechanism!.id} className="mb-1 last:mb-0">
                  <p className="font-medium">{mechanism!.title}</p>
                  {mechanism!.summary ? (
                    <p className="text-[var(--color-muted)]">{mechanism!.summary}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <Legend mode={mode} />
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

function Legend({ mode }: { mode: RenderMode }) {
  const { object_types } = useDictionaries();

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-[var(--color-line)] bg-white/90 p-2 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ maxWidth: 420 }}>
        {object_types.slice(0, 6).map((type) => (
          <span key={type.code} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: type.color }} />
            {type.title}
          </span>
        ))}
        {mode === 'full' ? (
          <span className="flex items-center gap-1">
            <span className="size-2" style={{ background: '#5a6570' }} />
            механизм
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[var(--color-muted)]">
        размер — по числу связей · приглушенные полупрозрачны
      </p>
    </div>
  );
}
