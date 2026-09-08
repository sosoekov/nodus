import { EventEmitter } from 'node:events';

export interface ChangeEvent {
  seq: number;
  entity_type: 'object' | 'mechanism' | 'participant';
  entity_id: string;
  op: 'create' | 'update' | 'delete';
  payload: unknown;
  user_id: string | null;
  created_at: string;
}

type Listener = (event: ChangeEvent) => void;

/**
 * Инстанс бэкенда один, поэтому шина живет в памяти процесса — Redis не нужен.
 * Публикация идет только после коммита: подписчик не должен увидеть патч,
 * которого еще нет в базе (иначе на реконнекте /api/changes его не отдаст).
 */
class ChangeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // По подписчику на каждую открытую вкладку — предел по умолчанию тесен.
    this.emitter.setMaxListeners(0);
  }

  publish(events: ChangeEvent[]): void {
    for (const event of events) this.emitter.emit('change', event);
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }

  get subscriberCount(): number {
    return this.emitter.listenerCount('change');
  }
}

export const changeBus = new ChangeBus();
