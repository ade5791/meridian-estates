// Minimal event bus. Cross-subsystem communication ONLY through this,
// using the vocabulary declared in ARCHITECTURE.md / core/vocabulary.js.

export class EventBus {
  constructor() {
    this.handlers = {}; // event -> [fn]
    this.anyHandlers = [];
  }
  on(event, fn) {
    (this.handlers[event] = this.handlers[event] || []).push(fn);
    return () => this.off(event, fn);
  }
  onAny(fn) {
    this.anyHandlers.push(fn);
    return () => { this.anyHandlers = this.anyHandlers.filter((f) => f !== fn); };
  }
  off(event, fn) {
    if (this.handlers[event]) this.handlers[event] = this.handlers[event].filter((f) => f !== fn);
  }
  emit(event, payload) {
    for (const fn of this.anyHandlers) fn(event, payload);
    const hs = this.handlers[event];
    if (hs) for (const fn of hs.slice()) fn(payload);
  }
}
