import { MultiDirectedGraph } from 'graphology';
import type { ObjectType } from '../api/types';
import type { GraphState, RenderMode } from './types';

export interface NodeAttrs {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  /** Программа отрисовки sigma: круг для объектов, квадрат для механизмов. */
  type: 'circle' | 'square';
  kind: 'object' | 'mechanism';
  /** Черновики и заглушки рисуются приглушенно. */
  faded: boolean;
  entityId: string;
  /** Сколько реквизитов свернуто в этот узел. */
  collapsed: number;
  detail: string;
  /** Показывать подпись независимо от плотности — для подсвеченных узлов. */
  forceLabel?: boolean;
}

export interface EdgeAttrs {
  size: number;
  color: string;
  type: 'arrow' | 'line';
  /** Механизмы, породившие ребро. В объектном режиме их может быть несколько. */
  mechanismIds: string[];
  label: string;
  faded: boolean;
}

export type NodusGraph = MultiDirectedGraph<NodeAttrs, EdgeAttrs>;

export interface BuildOptions {
  mode: RenderMode;
  /** Объекты, чьи реквизиты показаны отдельными узлами. */
  expanded: Set<string>;
  /** Ограничение по множеству объектов — локальный граф и фильтры. */
  visibleObjects?: Set<string>;
  /** Объект, вокруг которого построен граф: рисуется крупнее остальных. */
  rootId?: string;
}

const FADED_OBJECT_STATUSES = new Set(['stub', 'deprecated']);
const FADED_MECHANISM_STATUSES = new Set(['draft', 'deprecated']);

const MECHANISM_COLOR = '#5a6570';
const EDGE_COLOR = '#c3cad3';

/**
 * Стартовая позиция узла без сохраненных координат — из хеша его id, а не
 * случайная. Раскладка локального графа считается на лету, и со случайным
 * стартом одна и та же окрестность каждый раз выглядела бы иначе: человек
 * теряет пространственную память о графе.
 */
function seededPosition(id: string): { x: number; y: number } {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 4294967295) * Math.PI * 2;
  const radius = 0.5 + (((hash >>> 8) >>> 0) % 1000) / 2000;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Реквизиты по умолчанию свернуты в родителя: на 1000+ объектов они утраивают
 * число узлов, ничего не добавляя к картине связей. Функция отвечает, каким
 * узлом представлен объект.
 */
function resolveNode(
  objectId: string,
  state: GraphState,
  expanded: Set<string>,
): string | null {
  const object = state.objects.get(objectId);
  if (!object) return null;
  if (!object.parent_id) return objectId;
  if (expanded.has(object.parent_id)) return objectId;
  // Родителя может не быть в выдаче (отфильтрован) — тогда показываем сам реквизит.
  return state.objects.has(object.parent_id) ? object.parent_id : objectId;
}

export function buildGraph(
  state: GraphState,
  types: Map<string, ObjectType>,
  options: BuildOptions,
): NodusGraph {
  const graph: NodusGraph = new MultiDirectedGraph();
  const { mode, expanded, visibleObjects, rootId } = options;

  const isVisible = (objectId: string) => !visibleObjects || visibleObjects.has(objectId);

  // 1. Узлы-объекты. Свернутые реквизиты считаем, чтобы показать это на узле.
  const collapsedCount = new Map<string, number>();
  for (const object of state.objects.values()) {
    if (!isVisible(object.id)) continue;
    const node = resolveNode(object.id, state, expanded);
    if (node && node !== object.id) {
      collapsedCount.set(node, (collapsedCount.get(node) ?? 0) + 1);
    }
  }

  for (const object of state.objects.values()) {
    if (!isVisible(object.id)) continue;
    if (resolveNode(object.id, state, expanded) !== object.id) continue;

    const seeded = seededPosition(object.id);
    graph.addNode(object.id, {
      label: object.name,
      x: object.x ?? seeded.x,
      y: object.y ?? seeded.y,
      size: 4,
      color: types.get(object.type_code)?.color ?? '#9aa5b1',
      type: 'circle',
      kind: 'object',
      faded: FADED_OBJECT_STATUSES.has(object.status),
      entityId: object.id,
      collapsed: collapsedCount.get(object.id) ?? 0,
      detail: types.get(object.type_code)?.title ?? object.type_code,
    });
  }

  // 2. Участники, приведенные к видимым узлам.
  interface Resolved {
    node: string;
    direction: 'source' | 'target' | 'neutral';
  }
  const byMechanism = new Map<string, Resolved[]>();

  for (const participant of state.participants.values()) {
    if (!isVisible(participant.object_id)) continue;
    const node = resolveNode(participant.object_id, state, expanded);
    if (!node || !graph.hasNode(node)) continue;

    const list = byMechanism.get(participant.mechanism_id) ?? [];
    list.push({
      node,
      direction: state.roleDirection.get(participant.role_code) ?? 'neutral',
    });
    byMechanism.set(participant.mechanism_id, list);
  }

  if (mode === 'full') {
    for (const [mechanismId, resolved] of byMechanism) {
      const mechanism = state.mechanisms.get(mechanismId);
      if (!mechanism) continue;

      const seeded = seededPosition(mechanismId);
      graph.addNode(mechanismId, {
        label: mechanism.title,
        x: seeded.x,
        y: seeded.y,
        size: 5,
        color: MECHANISM_COLOR,
        type: 'square',
        kind: 'mechanism',
        faded: FADED_MECHANISM_STATUSES.has(mechanism.status),
        entityId: mechanismId,
        collapsed: 0,
        detail: mechanism.summary ?? '',
      });

      // Источник входит в механизм, приемник выходит из него: стрелки читаются
      // как «что на что влияет», а не просто «связано».
      for (const { node, direction } of dedupe(resolved)) {
        const [from, to] = direction === 'target' ? [mechanismId, node] : [node, mechanismId];
        graph.addEdge(from, to, {
          size: 1,
          color: EDGE_COLOR,
          type: direction === 'neutral' ? 'line' : 'arrow',
          mechanismIds: [mechanismId],
          label: mechanism.title,
          faded: FADED_MECHANISM_STATUSES.has(mechanism.status),
        });
      }
    }
  } else {
    // Объектный режим: механизм не рисуется, но его смысл сохраняется в
    // направлении ребер — каждый источник ведет в каждый приемник.
    const merged = new Map<string, { from: string; to: string; ids: string[]; arrow: boolean }>();

    for (const [mechanismId, resolved] of byMechanism) {
      if (!state.mechanisms.has(mechanismId)) continue;
      const unique = dedupe(resolved);

      const sources = unique.filter((item) => item.direction === 'source').map((i) => i.node);
      const targets = unique.filter((item) => item.direction === 'target').map((i) => i.node);
      const neutrals = unique.filter((item) => item.direction === 'neutral').map((i) => i.node);

      const pairs: Array<[string, string, boolean]> = [];

      if (targets.length) {
        for (const from of [...sources, ...neutrals]) {
          for (const to of targets) if (from !== to) pairs.push([from, to, true]);
        }
        // Приемники одного механизма связаны между собой, но не влияют друг
        // на друга — соединяем их без стрелки.
        for (let i = 0; i < targets.length; i += 1) {
          for (let j = i + 1; j < targets.length; j += 1) pairs.push([targets[i], targets[j], false]);
        }
      } else {
        // Приемника нет — направление неизвестно, соединяем всех попарно.
        const all = unique.map((item) => item.node);
        for (let i = 0; i < all.length; i += 1) {
          for (let j = i + 1; j < all.length; j += 1) pairs.push([all[i], all[j], false]);
        }
      }

      for (const [from, to, arrow] of pairs) {
        const key = arrow ? `>${from}|${to}` : `-${[from, to].sort().join('|')}`;
        const existing = merged.get(key);
        // Два механизма между теми же объектами — одно ребро, но панель по
        // клику покажет оба.
        if (existing) existing.ids.push(mechanismId);
        else merged.set(key, { from, to, ids: [mechanismId], arrow });
      }
    }

    for (const { from, to, ids, arrow } of merged.values()) {
      const titles = ids
        .map((id) => state.mechanisms.get(id)?.title)
        .filter(Boolean)
        .join(' · ');
      const allFaded = ids.every((id) =>
        FADED_MECHANISM_STATUSES.has(state.mechanisms.get(id)?.status ?? 'active'),
      );

      graph.addEdge(from, to, {
        size: Math.min(1 + (ids.length - 1) * 0.6, 4),
        color: EDGE_COLOR,
        type: arrow ? 'arrow' : 'line',
        mechanismIds: ids,
        label: titles,
        faded: allFaded,
      });
    }
  }

  // 3. Размер узла — по числу связей.
  let maxDegree = 1;
  graph.forEachNode((node) => {
    maxDegree = Math.max(maxDegree, graph.degree(node));
  });

  graph.forEachNode((node) => {
    const ratio = graph.degree(node) / maxDegree;
    // Нижняя граница заметно больше нуля: изолированный узел без связей
    // иначе превращается в еле различимую точку, особенно если он приглушен.
    const base = 6 + ratio * 10;
    // Корень локального графа заметен размером, а не приглушением остальных:
    // выцветший на 15% граф при открытии нечитаем, а смотрят именно на него.
    graph.setNodeAttribute(node, 'size', node === rootId ? base * 1.6 : base);
    if (node === rootId) graph.setNodeAttribute(node, 'forceLabel', true);
  });

  return graph;
}

/** Один объект может входить в механизм в нескольких ролях — узел все равно один. */
function dedupe<T extends { node: string; direction: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = `${item.node}|${item.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Обход в ширину от объекта по ребрам графа связей — основа локального графа.
 * Идет по неориентированным связям: «что рядом» важнее направления.
 */
export function neighbourhood(
  state: GraphState,
  rootId: string,
  depth: number,
): Set<string> {
  const byObject = new Map<string, Set<string>>();

  for (const participant of state.participants.values()) {
    const list = byObject.get(participant.object_id) ?? new Set<string>();
    list.add(participant.mechanism_id);
    byObject.set(participant.object_id, list);
  }

  const byMechanism = new Map<string, Set<string>>();
  for (const participant of state.participants.values()) {
    const list = byMechanism.get(participant.mechanism_id) ?? new Set<string>();
    list.add(participant.object_id);
    byMechanism.set(participant.mechanism_id, list);
  }

  const visited = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const objectId of frontier) {
      for (const mechanismId of byObject.get(objectId) ?? []) {
        for (const neighbour of byMechanism.get(mechanismId) ?? []) {
          if (visited.has(neighbour)) continue;
          visited.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    if (!next.length) break;
    frontier = next;
  }

  // Реквизиты корня и соседей нужны, чтобы их можно было развернуть.
  for (const object of state.objects.values()) {
    if (object.parent_id && visited.has(object.parent_id)) visited.add(object.id);
  }

  return visited;
}
