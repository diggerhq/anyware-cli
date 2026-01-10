/**
 * Message queue for handling incoming messages from web
 */

// Image attachment from web UI
export interface ImageAttachment {
  name: string;
  mimeType: string;
  data: string; // base64 encoded image data
}

// Queue message with optional images
export interface QueueMessage {
  message: string;
  images?: ImageAttachment[];
}

export class MessageQueue {
  private queue: QueueMessage[] = [];
  private waitResolve: ((message: QueueMessage | null) => void) | null = null;
  private onMessageCallback: ((message: QueueMessage) => void) | null = null;
  private closed = false;

  /**
   * Add a message to the queue
   */
  push(message: string, images?: ImageAttachment[]): void {
    if (this.closed) return;

    const queueMsg: QueueMessage = { message, images };

    // Notify callback if set
    if (this.onMessageCallback) {
      this.onMessageCallback(queueMsg);
    }

    // Resolve waiting promise if any
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve(queueMsg);
      return;
    }

    // Otherwise add to queue
    this.queue.push(queueMsg);
  }

  /**
   * Get next message from queue (non-blocking)
   */
  pop(): QueueMessage | null {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    return null;
  }

  /**
   * Wait for next message (blocking)
   */
  async waitForMessage(): Promise<QueueMessage | null> {
    if (this.closed) return null;

    // Return from queue if available
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }

    // Wait for new message
    return new Promise((resolve) => {
      this.waitResolve = resolve;
    });
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Reset queue (clear all messages)
   */
  reset(): void {
    this.queue = [];

    // Resolve waiting promise with null
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve(null);
    }
  }

  /**
   * Set callback for when messages arrive
   */
  setOnMessage(callback: ((message: QueueMessage) => void) | null): void {
    this.onMessageCallback = callback;
  }

  /**
   * Close the queue
   */
  close(): void {
    this.closed = true;
    this.reset();
  }
}
