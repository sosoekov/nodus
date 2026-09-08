import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent } from '../api/types';

type Listener = (event: ChangeEvent) => void;

interface LiveState {
  connected: boolean;
  /** Последний применённый курсор — по нему видно, насколько клиент свеж. */
  seq: number;
  subscribe(listener: Listener): () => void;
}

const LiveContext = createContext<LiveState>({
  connected: false,
  seq: 0,
  subscribe: () => () => {},
});

/**
 * Одна SSE-подписка на вкладку. EventSource переподключается сам и присылает
 * Last-Event-ID, а сервер досылает пропущенное, так что отдельной догонки на
 * реконнекте здесь не нужно.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [seq, setSeq] = useState(0);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));

    source.addEventListener('hello', (event) => {
      setConnected(true);
      setSeq(JSON.parse((event as MessageEvent<string>).data).seq);
    });

    source.addEventListener('change', (event) => {
      const change = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
      setSeq((current) => Math.max(current, change.seq));
      for (const listener of listeners.current) listener(change);
    });

    return () => source.close();
  }, []);

  // Стабильная ссылка: иначе useOnChange переподписывался бы на каждый рендер.
  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ connected, seq, subscribe }), [connected, seq, subscribe]);

  return <LiveContext value={value}>{children}</LiveContext>;
}

export function useLive(): LiveState {
  return use(LiveContext);
}

/** Вызывает `onChange` на каждый патч; удобно для «перечитай, если тронули моё». */
export function useOnChange(onChange: Listener): void {
  const { subscribe } = useLive();
  const ref = useRef(onChange);
  ref.current = onChange;

  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
