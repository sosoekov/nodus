export interface SseMessage {
  id?: string;
  event: string;
  data: unknown;
}

/** Минимальный клиент SSE: копит пришедшие события и умеет их дожидаться. */
export class SseClient {
  readonly messages: SseMessage[] = [];
  private buffer = '';
  private done = false;

  private constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly controller: AbortController,
  ) {}

  static async connect(
    baseUrl: string,
    cookie: string,
    lastEventId?: number,
  ): Promise<SseClient> {
    const headers: Record<string, string> = { cookie, accept: 'text/event-stream' };
    if (lastEventId !== undefined) headers['last-event-id'] = String(lastEventId);

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed: ${response.status}`);
    }

    const client = new SseClient(response.body.getReader(), controller);
    void client.pump();
    return client;
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      while (!this.done) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });

        let boundary = this.buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = this.buffer.slice(0, boundary);
          this.buffer = this.buffer.slice(boundary + 2);
          this.parse(frame);
          boundary = this.buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Поток закрыли — это нормальное завершение.
    }
  }

  private parse(frame: string): void {
    // Комментарии-пинги (': ping') событиями не являются.
    if (!frame.trim() || frame.startsWith(':')) return;

    let id: string | undefined;
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      if (line.startsWith('id: ')) id = line.slice(4);
      else if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    }

    if (!dataLines.length) return;
    this.messages.push({ id, event, data: JSON.parse(dataLines.join('\n')) });
  }

  async waitFor(
    predicate: (message: SseMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<SseMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `SSE: событие не пришло за ${timeoutMs} мс. Получено: ${JSON.stringify(this.messages)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  changes(): SseMessage[] {
    return this.messages.filter((message) => message.event === 'change');
  }

  close(): void {
    this.done = true;
    this.controller.abort();
    void this.reader.cancel().catch(() => {});
  }
}
