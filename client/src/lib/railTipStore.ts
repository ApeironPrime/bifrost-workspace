export interface RailTipState {
  label: string;
  top: number;
}

export interface RailTipStore {
  getSnapshot: () => RailTipState | null;
  subscribe: (listener: () => void) => () => void;
  set: (next: RailTipState | null) => void;
}

/** Creates an external tooltip store so collapsed-rail hover updates never re-render App. */
export function createRailTipStore(): RailTipStore {
  let current: RailTipState | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (
        current === next ||
        (current && next && current.label === next.label && current.top === next.top)
      ) {
        return;
      }
      current = next;
      listeners.forEach((listener) => listener());
    },
  };
}
