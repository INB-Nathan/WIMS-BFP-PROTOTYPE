import '@testing-library/jest-dom'

// Required for OIDC module guard; tests need NEXT_PUBLIC_AUTH_API_URL
process.env.NEXT_PUBLIC_AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost/auth'

// jsdom does not implement EventSource (SSE browser API). Provide a stub so
// hooks that call `new EventSource(...)` (e.g. useEventStream, useAutoRefresh)
// don't throw during unit tests. Unlike a pure no-op, this stub keeps a public
// registry of live instances and exposes a dispatch helper so tests can push
// named SSE events through `addEventListener('event-type', ...)` listeners —
// otherwise SSE-driven logic (useEventStream, useAutoRefresh) is untestable.
class EventSourceStub {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  url: string;
  withCredentials: boolean;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  listeners: Map<string, EventListenerOrEventListenerObject[]> = new Map();

  /** All live (not-yet-closed) instances, in creation order. */
  static instances: EventSourceStub[] = [];

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    this.readyState = this.OPEN;
    EventSourceStub.instances.push(this);
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const arr = this.listeners.get(type);
    if (arr) this.listeners.set(type, arr.filter((l) => l !== listener));
  }
  dispatchEvent(event: Event): boolean {
    const handlers = this.listeners.get(event.type) ?? [];
    for (const handler of handlers) {
      if (typeof handler === 'function') handler(event);
      else handler.handleEvent(event);
    }
    if (event.type === 'message') this.onmessage?.(event as MessageEvent);
    return true;
  }
  close() {
    this.readyState = this.CLOSED;
    EventSourceStub.instances = EventSourceStub.instances.filter((i) => i !== this);
  }

  /** Test helper: dispatch a named SSE event (e.g. "incident.updated") with a JSON-serializable payload. */
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
// @ts-expect-error — intentional partial stub for test environment
globalThis.EventSource = EventSourceStub;

export { EventSourceStub };
