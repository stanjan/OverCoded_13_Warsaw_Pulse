export class JobPool {
  active = 0;
  queue = [];
  constructor({ concurrency = 4, maxQueue = 32, waitMs = 120000 } = {}) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.waitMs = waitMs;
  }
  acquire(signal) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Request cancelled'), { statusCode: 499 }));
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(Object.assign(new Error('Codex waiting queue is full. Retry later.'), { statusCode: 429 }));
    return new Promise((resolve, reject) => {
      const entry = { resolve, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); } };
      const remove = (message, statusCode) => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        entry.cleanup();
        reject(Object.assign(new Error(message), { statusCode }));
      };
      const cancel = () => remove('Request cancelled while waiting', 499);
      const timer = setTimeout(() => remove('Codex queue wait timed out. Retry later.', 429), this.waitMs);
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(entry);
    });
  }
  releaseOnce() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next.cleanup();
        next.resolve(this.releaseOnce());
      } else this.active--;
    };
  }
}
