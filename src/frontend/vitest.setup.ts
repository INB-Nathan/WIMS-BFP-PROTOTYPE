import '@testing-library/jest-dom'

// Required for OIDC module guard; tests need NEXT_PUBLIC_AUTH_API_URL
process.env.NEXT_PUBLIC_AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost/auth'

// jsdom does not implement EventSource (SSE browser API). Provide a no-op stub
// so hooks that call `new EventSource(...)` (e.g. useEventStream, useAutoRefresh)
// don't throw during unit tests. The stub never actually emits events.
if (typeof globalThis.EventSource === 'undefined') {
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
    private _listeners: Map<string, EventListenerOrEventListenerObject[]> = new Map();

    constructor(url: string, init?: EventSourceInit) {
      this.url = url;
      this.withCredentials = init?.withCredentials ?? false;
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type)!.push(listener);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const arr = this._listeners.get(type);
      if (arr) this._listeners.set(type, arr.filter((l) => l !== listener));
    }
    dispatchEvent(_event: Event): boolean { return true; }
    close() { this.readyState = 2; }
  }
  // @ts-expect-error — intentional partial stub for test environment
  globalThis.EventSource = EventSourceStub;
}
