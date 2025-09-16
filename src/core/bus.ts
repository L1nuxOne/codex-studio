export type EventHandler<T = unknown> = (payload: T) => void;

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    const set = this.listeners.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.listeners.set(type, set);
    return () => {
      const handlers = this.listeners.get(type);
      if (!handlers) return;
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  emit<T = unknown>(type: string, payload?: T): void {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      try {
        (handler as EventHandler<T>)(payload as T);
      } catch (err) {
        console.error(`Event handler for ${type} failed`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const bus = new EventBus();
