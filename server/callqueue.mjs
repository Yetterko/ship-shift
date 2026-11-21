// The stove: a global limit on model calls in flight, with a FIFO queue and a priority lane (judges, the showcase floor).

export class CallQueue {
  /** @param {number} max calls in flight at once */
  constructor(max = 20) {
    this.max = max;
    this.inflight = 0;
    /** @type {{start:()=>void, priority:boolean, cancelled:boolean}[]} */
    this.waiting = [];
  }

  /** True when a call sent now would have to wait for a stove. */
  get busy() { return this.inflight >= this.max; }

  /**
   * Runs fn when a stove is free. onStart fires at that moment (at once when a stove is free now).
   * An aborted signal drops a call that is still waiting.
   * @template T
   * @param {() => Promise<T>} fn
   * @param {{priority?: boolean, onStart?: () => void, signal?: AbortSignal}} [opts]
   * @returns {Promise<T>}
   */
  run(fn, { priority = false, onStart, signal } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { priority, cancelled: false, start: null };
      entry.start = () => {
        this.inflight++;
        let p;
        try { onStart?.(); p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
        p.then(resolve, reject).finally(() => { this.inflight--; this.#next(); });
      };
      if (signal?.aborted) return reject(abortError());
      signal?.addEventListener('abort', () => {
        const i = this.waiting.indexOf(entry);
        if (i >= 0) { this.waiting.splice(i, 1); reject(abortError()); }
      }, { once: true });
      if (this.inflight < this.max) return entry.start();
      if (priority) {
        const firstPlain = this.waiting.findIndex(w => !w.priority);
        this.waiting.splice(firstPlain < 0 ? this.waiting.length : firstPlain, 0, entry);
      } else this.waiting.push(entry);
    });
  }

  #next() {
    while (this.inflight < this.max && this.waiting.length) this.waiting.shift().start();
  }

  stats() { return { inflight: this.inflight, waiting: this.waiting.length }; }
}

const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
