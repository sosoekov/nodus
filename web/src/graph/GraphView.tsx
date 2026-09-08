import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import { NodeSquareProgram } from '@sigma/node-square';
import { EdgeArrowProgram, EdgeRectangleProgram, NodeCircleProgram } from 'sigma/rendering';
import type { EdgeAttrs, NodeAttrs, NodusGraph } from './build';
import type { Selection } from './types';

/** Приглушение остального графа — 15% непрозрачности, как в требованиях. */
const DIM = 0.15;
const FADED = 0.45;

function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const value = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Props {
  graph: NodusGraph;
  /** Пересчитывать раскладку. Локальный граф — да, полный — нет. */
  runLayout: boolean;
  onSelect(selection: Selection): void;
  onHoverEdge?(edge: { mechanismIds: string[]; x: number; y: number } | null): void;
}

export function GraphView({ graph, runLayout, onSelect, onHoverEdge }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);

  // Ховер и фиксация живут в ref: менять их через состояние React значило бы
  // пересоздавать sigma на каждое движение мыши.
  const hoveredRef = useRef<string | null>(null);
  const fixedRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const onHoverEdgeRef = useRef(onHoverEdge);
  onSelectRef.current = onSelect;
  onHoverEdgeRef.current = onHoverEdge;

  useEffect(() => {
    if (!containerRef.current) return;

    if (runLayout) {
      // Расчет только для локального графа: он мал, а на полном раскладка
      // берется из базы, иначе картинка каждый раз новая и пространственная
      // память о графе теряется.
      forceAtlas2.assign(graph, {
        iterations: graph.order > 150 ? 120 : 250,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          gravity: 1.2,
          scalingRatio: 12,
        },
      });
    }

    const renderer = new Sigma<NodeAttrs, EdgeAttrs>(graph, containerRef.current, {
      nodeProgramClasses: { circle: NodeCircleProgram, square: NodeSquareProgram },
      edgeProgramClasses: { arrow: EdgeArrowProgram, line: EdgeRectangleProgram },
      renderEdgeLabels: false,
      // По умолчанию sigma не отслеживает события на ребрах ради
      // производительности — без этого не работают ни всплывающий summary
      // механизма на ховере, ни открытие панели по клику на ребро.
      enableEdgeEvents: true,
      labelDensity: 0.5,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 5,
      labelFont: 'system-ui, sans-serif',
      labelSize: 12,
      minEdgeThickness: 1.2,
      defaultDrawNodeHover: () => {},
    });

    sigmaRef.current = renderer;

    const focused = () => fixedRef.current ?? hoveredRef.current;

    const relatedTo = (node: string): Set<string> => {
      const set = new Set<string>([node]);
      graph.forEachNeighbor(node, (neighbour) => set.add(neighbour));
      return set;
    };

    renderer.setSetting('nodeReducer', (node, data) => {
      const target = focused();
      const result = { ...data };

      if (data.faded) result.color = withAlpha(data.color, FADED);
      if (data.collapsed) result.label = `${data.label} +${data.collapsed}`;

      if (!target) return result;

      const related = relatedTo(target);
      if (!related.has(node)) {
        result.color = withAlpha(data.color, DIM);
        // Подпись приглушенного узла только мешает читать подсвеченное.
        result.label = '';
        return result;
      }

      if (node === target) result.size = data.size * 1.35;
      result.forceLabel = true;
      return result;
    });

    renderer.setSetting('edgeReducer', (edge, data) => {
      const target = focused();
      const result = { ...data };

      if (data.faded) result.color = withAlpha(data.color, FADED);
      if (!target) return result;

      const [from, to] = graph.extremities(edge);
      if (from !== target && to !== target) {
        result.color = withAlpha(data.color, DIM);
        return result;
      }

      result.color = '#7b8794';
      result.size = data.size + 0.8;
      return result;
    });

    const refresh = () => renderer.refresh({ skipIndexation: true });

    renderer.on('enterNode', ({ node }) => {
      hoveredRef.current = node;
      refresh();
    });

    renderer.on('leaveNode', () => {
      hoveredRef.current = null;
      refresh();
    });

    // Клик фиксирует подсветку: без этого нельзя увести мышь к панели, не
    // потеряв выделение. Клик по другому узлу переносит фиксацию на него.
    renderer.on('clickNode', ({ node }) => {
      fixedRef.current = node;
      const attrs = graph.getNodeAttributes(node);
      onSelectRef.current(
        attrs.kind === 'mechanism'
          ? { kind: 'mechanism', id: attrs.entityId }
          : { kind: 'object', id: attrs.entityId },
      );
      refresh();
    });

    renderer.on('clickEdge', ({ edge }) => {
      onSelectRef.current({ kind: 'edge', mechanismIds: graph.getEdgeAttribute(edge, 'mechanismIds') });
    });

    renderer.on('enterEdge', ({ edge, event }) => {
      onHoverEdgeRef.current?.({
        mechanismIds: graph.getEdgeAttribute(edge, 'mechanismIds'),
        x: event.x,
        y: event.y,
      });
    });

    renderer.on('leaveEdge', () => onHoverEdgeRef.current?.(null));

    renderer.on('clickStage', () => {
      fixedRef.current = null;
      onSelectRef.current(null);
      onHoverEdgeRef.current?.(null);
      refresh();
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      hoveredRef.current = null;
      fixedRef.current = null;
    };
  }, [graph, runLayout]);

  return <div ref={containerRef} className="h-full w-full" />;
}
