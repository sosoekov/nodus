import type { GraphState } from './types';

/** Шаг цепочки: через какой механизм и в какой роли попали в следующий объект. */
export interface PathStep {
  mechanism_id: string;
  /** Роль объекта, из которого шагнули. */
  from_role: string;
  to_role: string;
  object_id: string;
}

export interface FoundPath {
  /** Объекты по порядку, включая начальный. */
  objects: string[];
  steps: PathStep[];
}

export const MAX_DEPTH = 5;
export const MAX_PATHS = 20;

interface Link {
  mechanism_id: string;
  from_role: string;
  to_role: string;
  object_id: string;
}

/**
 * Связи объект→объект через механизмы. Строится один раз на поиск: полный
 * список ребер уже в памяти после снапшота, отдельный эндпоинт не нужен.
 *
 * `directed = true` оставляет только переходы source → target: на этом строится
 * анализ влияния, где важно, что на что влияет, а не что рядом.
 */
function buildAdjacency(state: GraphState, directed: boolean): Map<string, Link[]> {
  const participantsByMechanism = new Map<
    string,
    Array<{ object_id: string; role_code: string; direction: string }>
  >();

  for (const participant of state.participants.values()) {
    if (!state.mechanisms.has(participant.mechanism_id)) continue;
    if (!state.objects.has(participant.object_id)) continue;

    const list = participantsByMechanism.get(participant.mechanism_id) ?? [];
    list.push({
      object_id: participant.object_id,
      role_code: participant.role_code,
      direction: state.roleDirection.get(participant.role_code) ?? 'neutral',
    });
    participantsByMechanism.set(participant.mechanism_id, list);
  }

  const adjacency = new Map<string, Link[]>();
  const connect = (from: string, to: string, mechanismId: string, fromRole: string, toRole: string) => {
    if (from === to) return;
    const list = adjacency.get(from) ?? [];
    list.push({ mechanism_id: mechanismId, from_role: fromRole, to_role: toRole, object_id: to });
    adjacency.set(from, list);
  };

  for (const [mechanismId, participants] of participantsByMechanism) {
    if (directed) {
      const sources = participants.filter((item) => item.direction !== 'target');
      const targets = participants.filter((item) => item.direction === 'target');
      for (const from of sources) {
        for (const to of targets) {
          connect(from.object_id, to.object_id, mechanismId, from.role_code, to.role_code);
        }
      }
    } else {
      for (const from of participants) {
        for (const to of participants) {
          connect(from.object_id, to.object_id, mechanismId, from.role_code, to.role_code);
        }
      }
    }
  }

  return adjacency;
}

/**
 * Все цепочки между двумя объектами. Обход в ширину с ограничениями из ТЗ:
 * глубина не больше 5, не больше 20 путей — иначе на плотном графе поиск
 * взрывается комбинаторно и выдает нечитаемую простыню.
 */
export function findPaths(
  state: GraphState,
  fromId: string,
  toId: string,
  options: { maxDepth?: number; maxPaths?: number; directed?: boolean } = {},
): { paths: FoundPath[]; truncated: boolean } {
  const maxDepth = Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH);
  const maxPaths = Math.min(options.maxPaths ?? MAX_PATHS, MAX_PATHS);
  const adjacency = buildAdjacency(state, options.directed ?? false);

  const found: FoundPath[] = [];
  if (fromId === toId) return { paths: found, truncated: false };

  const queue: FoundPath[] = [{ objects: [fromId], steps: [] }];
  let truncated = false;

  while (queue.length) {
    const current = queue.shift()!;
    if (current.steps.length >= maxDepth) continue;

    const last = current.objects[current.objects.length - 1];
    for (const link of adjacency.get(last) ?? []) {
      // Цикл через уже пройденный объект цепочку не удлиняет осмысленно.
      if (current.objects.includes(link.object_id)) continue;

      const next: FoundPath = {
        objects: [...current.objects, link.object_id],
        steps: [...current.steps, link],
      };

      if (link.object_id === toId) {
        found.push(next);
        if (found.length >= maxPaths) return { paths: found, truncated: true };
        continue;
      }

      queue.push(next);
    }

    if (queue.length > 20_000) {
      truncated = true;
      break;
    }
  }

  return { paths: found, truncated };
}

export interface ImpactNode {
  object_id: string;
  depth: number;
  /** Через какой механизм пришли сюда впервые. */
  via_mechanism: string;
  via_role: string;
  from_object: string;
}

/**
 * Транзитивное влияние по ребрам source → target. `direction: 'downstream'` —
 * на что влияет объект, `'upstream'` — от чего он зависит.
 */
export function analyseImpact(
  state: GraphState,
  rootId: string,
  direction: 'downstream' | 'upstream',
  maxDepth = MAX_DEPTH,
): ImpactNode[] {
  const forward = buildAdjacency(state, true);

  // Для «от чего зависит» разворачиваем те же направленные ребра.
  const adjacency =
    direction === 'downstream'
      ? forward
      : (() => {
          const reversed = new Map<string, Link[]>();
          for (const [from, links] of forward) {
            for (const link of links) {
              const list = reversed.get(link.object_id) ?? [];
              list.push({ ...link, object_id: from });
              reversed.set(link.object_id, list);
            }
          }
          return reversed;
        })();

  const seen = new Set<string>([rootId]);
  const result: ImpactNode[] = [];
  let frontier = [rootId];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next: string[] = [];
    for (const objectId of frontier) {
      for (const link of adjacency.get(objectId) ?? []) {
        if (seen.has(link.object_id)) continue;
        seen.add(link.object_id);
        result.push({
          object_id: link.object_id,
          depth,
          via_mechanism: link.mechanism_id,
          via_role: direction === 'downstream' ? link.to_role : link.from_role,
          from_object: objectId,
        });
        next.push(link.object_id);
      }
    }
    if (!next.length) break;
    frontier = next;
  }

  return result;
}
