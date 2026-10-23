import type { EngineMessage, EngineStoppedMsg, UiMessage } from './protocol';

export type ClientEvent = EngineMessage | EngineStoppedMsg;
type Handler = (m: ClientEvent) => void;

/** Typed WebSocket client. A socket close (engine died or exited) surfaces as {type:'engineStopped'}. */
export class EngineClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();

  connect(url: string): void {
    this.detach();
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (parsed && typeof (parsed as { type?: unknown }).type === 'string') {
        this.emit(parsed as EngineMessage);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // a socket we replaced or detached on purpose
      this.ws = null;
      this.emit({ type: 'engineStopped' });
    };
    ws.onerror = () => {
      // onclose follows an error and reports it
    };
  }

  send(m: UiMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private detach(): void {
    const old = this.ws;
    this.ws = null;
    if (old) {
      try {
        old.close();
      } catch {
        // already closed
      }
    }
  }

  private emit(m: ClientEvent): void {
    for (const h of [...this.handlers]) h(m);
  }
}

export const client = new EngineClient();
