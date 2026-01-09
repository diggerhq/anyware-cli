/**
 * Async stream implementation for SDK messages
 */

export class Stream<T> implements AsyncIterableIterator<T> {
  private queue: T[] = [];
  private readResolve: ((value: IteratorResult<T>) => void) | null = null;
  private readReject: ((error: Error) => void) | null = null;
  private isDone = false;
  private errorValue: Error | null = null;
  private started = false;

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.started) {
      throw new Error('Stream can only be iterated once');
    }
    this.started = true;
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    // Return error if set
    if (this.errorValue) {
      throw this.errorValue;
    }

    // Return queued items first
    if (this.queue.length > 0) {
      return { done: false, value: this.queue.shift()! };
    }

    // Return done if stream is complete
    if (this.isDone) {
      return { done: true, value: undefined };
    }

    // Wait for new data
    return new Promise((resolve, reject) => {
      this.readResolve = resolve;
      this.readReject = reject;
    });
  }

  return(value?: T): Promise<IteratorResult<T>> {
    this.done();
    return Promise.resolve({ done: true, value });
  }

  throw(e: Error): Promise<IteratorResult<T>> {
    this.error(e);
    return Promise.reject(e);
  }

  /**
   * Add item to the stream
   */
  enqueue(value: T): void {
    if (this.isDone) {
      return;
    }

    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = null;
      this.readReject = null;
      resolve({ done: false, value });
    } else {
      this.queue.push(value);
    }
  }

  /**
   * Mark stream as complete
   */
  done(): void {
    if (this.isDone) {
      return;
    }

    this.isDone = true;

    if (this.readResolve) {
      const resolve = this.readResolve;
      this.readResolve = null;
      this.readReject = null;
      resolve({ done: true, value: undefined });
    }
  }

  /**
   * Set error on stream
   */
  error(err: Error): void {
    this.errorValue = err;
    this.isDone = true;

    if (this.readReject) {
      const reject = this.readReject;
      this.readResolve = null;
      this.readReject = null;
      reject(err);
    }
  }
}
