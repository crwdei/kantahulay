export function requireNativeModule<T = any>(name: string): T {
  return {} as T;
}

export class EventEmitter {
  constructor(private nativeModule: any) {}
  addListener(eventName: string, listener: (...args: any[]) => void) {
    return { remove: () => {} };
  }
  removeAllListeners() {}
  emit(eventName: string, ...args: any[]) {}
}

export type EventSubscription = { remove: () => void };

