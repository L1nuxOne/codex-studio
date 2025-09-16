export type EventHandler<T = any> = (payload: T) => void;

type ListenerMap = Map<string, Set<EventHandler>>;

class EventBus {
  private listeners: ListenerMap = new Map();

  on<T>(type: string, handler: EventHandler<T>): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler as EventHandler);
    this.listeners.set(type, set);
    return () => this.off(type, handler as EventHandler);
  }

  once<T>(type: string, handler: EventHandler<T>): () => void {
    const disposable = this.on<T>(type, (payload) => {
      disposable();
      handler(payload);
    });
    return disposable;
  }

  off(type: string, handler: EventHandler): void {
    const set = this.listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  emit<T>(type: string, payload: T): void {
    const set = this.listeners.get(type);
    if (!set) return;
    [...set].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus] handler error for ${type}`, err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const bus = new EventBus();
