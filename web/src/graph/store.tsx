import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../api/client';
import type { ChangeEvent } from '../api/types';
import { useDictionaries } from '../hooks/useDictionaries';
import { useOnChange } from '../hooks/useLiveChanges';
import type {
  GraphMechanism,
  GraphObject,
  GraphParticipant,
  GraphState,
  Snapshot,
} from './types';

interface StoreValue {
  state: GraphState | null;
  loading: boolean;
  error: unknown;
  reload(): Promise<void>;
}

const GraphContext = createContext<StoreValue>({
  state: null,
  loading: true,
  error: null,
  reload: async () => {},
});

/** Мягко удаленное приходит патчем `delete` — из графа такой узел убираем. */
function isDeleted(payload: unknown): boolean {
  return Boolean((payload as { deleted_at?: string | null } | null)?.deleted_at);
}

/**
 * Копия графа в памяти вкладки. Снапшот загружается один раз, дальше состояние
 * догоняется патчами из SSE — полная перезагрузка на каждую чужую правку на
 * 1000+ объектов означала бы мегабайты трафика на ровном месте.
 */
export function GraphProvider({ children }: { children: ReactNode }) {
  const { participant_roles } = useDictionaries();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [objects, setObjects] = useState<Map<string, GraphObject>>(new Map());
  const [mechanisms, setMechanisms] = useState<Map<string, GraphMechanism>>(new Map());
  const [participants, setParticipants] = useState<Map<string, GraphParticipant>>(new Map());
  const [seq, setSeq] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await api.get<Snapshot>('/api/graph/snapshot');
      setSnapshot(loaded);
      setObjects(new Map(loaded.objects.map((item) => [item.id, item])));
      setMechanisms(new Map(loaded.mechanisms.map((item) => [item.id, item])));
      setParticipants(new Map(loaded.participants.map((item) => [item.id, item])));
      setSeq(loaded.seq);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useOnChange((event: ChangeEvent) => {
    // Патч старее снапшота уже в нем учтен.
    if (event.seq <= seq) return;
    setSeq(event.seq);

    if (event.entity_type === 'object') {
      const payload = event.payload as GraphObject | null;
      setObjects((current) => {
        const next = new Map(current);
        if (event.op === 'delete' || isDeleted(payload) || !payload) next.delete(event.entity_id);
        else {
          // Координаты живут в отдельной таблице и в патче объекта их нет —
          // сохраняем те, что пришли со снапшотом, иначе узел прыгнет в центр.
          const previous = current.get(event.entity_id);
          next.set(event.entity_id, {
            ...payload,
            x: previous?.x ?? null,
            y: previous?.y ?? null,
            pinned: previous?.pinned ?? null,
          });
        }
        return next;
      });
      return;
    }

    if (event.entity_type === 'mechanism') {
      const payload = event.payload as GraphMechanism | null;
      setMechanisms((current) => {
        const next = new Map(current);
        if (event.op === 'delete' || isDeleted(payload) || !payload) next.delete(event.entity_id);
        else next.set(event.entity_id, payload);
        return next;
      });
      return;
    }

    const payload = event.payload as GraphParticipant | null;
    setParticipants((current) => {
      const next = new Map(current);
      if (event.op === 'delete' || !payload) next.delete(event.entity_id);
      else next.set(event.entity_id, payload);
      return next;
    });
  });

  const state = useMemo<GraphState | null>(() => {
    if (!snapshot) return null;

    // Участники механизма, который уже удален, приходят из снапшота
    // отфильтрованными, но патч удаления механизма приходит без них — чистим
    // здесь, чтобы не осталось ребер к исчезнувшему узлу.
    const alive = new Map(
      [...participants].filter(
        ([, item]) => mechanisms.has(item.mechanism_id) && objects.has(item.object_id),
      ),
    );

    return {
      seq,
      objects,
      mechanisms,
      participants: alive,
      roleDirection: new Map(participant_roles.map((role) => [role.code, role.direction])),
    };
  }, [snapshot, objects, mechanisms, participants, seq, participant_roles]);

  const value = useMemo<StoreValue>(
    () => ({ state, loading, error, reload }),
    [state, loading, error, reload],
  );

  return <GraphContext value={value}>{children}</GraphContext>;
}

export function useGraphStore(): StoreValue {
  return use(GraphContext);
}
