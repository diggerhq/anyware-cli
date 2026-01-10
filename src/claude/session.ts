/**
 * Session class - manages session state and server communication
 */

import { createWSClient, type SessionWSClient, type IncomingMessage } from '../api/wsClient.js';
import { MessageQueue } from '../utils/messageQueue.js';

export interface SessionOptions {
  serverSessionId: string;
  userId: string;
  deviceId?: string;
  path: string;
  claudeArgs?: string[];
}

export type PermissionResponse = 'yes' | 'no' | 'always';

type PendingPermissionResponse = {
  response: PermissionResponse;
  receivedAt: number; // ms since epoch
};

export class Session {
  readonly serverSessionId: string;
  readonly userId: string;
  readonly deviceId?: string;
  readonly path: string;
  readonly queue: MessageQueue;

  private wsClient: SessionWSClient | null = null;
  private _claudeSessionId: string | null = null;
  private _claudeArgs: string[] | undefined;
  private sessionFoundCallbacks: Array<(sessionId: string) => void> = [];
  private userInputHandler: (() => void) | null = null;
  private switchHandler: (() => void) | null = null;
  private permissionResolver: ((response: PermissionResponse) => void) | null = null;
  private pendingPermissionResponse: PendingPermissionResponse | null = null;
  private permissionResponseTriggerSwitch: (() => void) | null = null;
  private alwaysAllowedTools: Set<string> = new Set();

  constructor(opts: SessionOptions) {
    this.serverSessionId = opts.serverSessionId;
    this.userId = opts.userId;
    this.deviceId = opts.deviceId;
    this.path = opts.path;
    this._claudeArgs = opts.claudeArgs;
    this.queue = new MessageQueue();
  }

  /**
   * Connect to the server WebSocket
   */
  async connect(): Promise<void> {
    this.wsClient = await createWSClient(this.serverSessionId, this.userId, this.deviceId);

    // Handle incoming messages
    this.wsClient.onMessage((message: IncomingMessage) => {
      this.handleMessage(message);
    });

    this.wsClient.onClose(() => {
      // WebSocket closed
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: IncomingMessage): void {
    switch (message.type) {
      case 'user_input':
        if (typeof message.payload?.prompt === 'string' && message.payload.prompt.trim().toLowerCase() === 'proceed') {
          console.warn('[ws] Received user_input "proceed" from web; pushing to queue');
        }
        this.queue.push(message.payload.prompt, message.payload.images);

        // Mark activity since user is interacting
        this.markActivity();

        // Notify handler
        if (this.userInputHandler) {
          this.userInputHandler();
        }
        break;

      case 'permission_response':
        // If we have a resolver (remote mode), use it directly
        if (this.permissionResolver) {
          const resolver = this.permissionResolver;
          this.permissionResolver = null;
          resolver(message.payload.response as PermissionResponse);
        } else {
          // In local mode: store the response and trigger switch to remote
          this.pendingPermissionResponse = {
            response: message.payload.response as PermissionResponse,
            receivedAt: Date.now(),
          };
          if (this.permissionResponseTriggerSwitch) {
            this.permissionResponseTriggerSwitch();
          }
        }
        break;

      case 'switch':
        if (this.switchHandler) {
          this.switchHandler();
        }
        break;
    }
  }

  /**
   * Get Claude session ID
   */
  get claudeSessionId(): string | null {
    return this._claudeSessionId;
  }

  /**
   * Set Claude session ID
   */
  setClaudeSessionId(sessionId: string): void {
    this._claudeSessionId = sessionId;

    // Notify all callbacks
    for (const callback of this.sessionFoundCallbacks) {
      callback(sessionId);
    }
  }

  /**
   * Get Claude args
   */
  get claudeArgs(): string[] | undefined {
    return this._claudeArgs;
  }

  /**
   * Add callback for when session ID is found
   */
  addSessionFoundCallback(callback: (sessionId: string) => void): void {
    this.sessionFoundCallbacks.push(callback);
  }

  /**
   * Remove session found callback
   */
  removeSessionFoundCallback(callback: (sessionId: string) => void): void {
    const index = this.sessionFoundCallbacks.indexOf(callback);
    if (index !== -1) {
      this.sessionFoundCallbacks.splice(index, 1);
    }
  }

  /**
   * Consume one-time flags like --continue and --resume after first spawn
   */
  consumeOneTimeFlags(): void {
    if (!this._claudeArgs) return;

    const filteredArgs: string[] = [];
    for (let i = 0; i < this._claudeArgs.length; i++) {
      const arg = this._claudeArgs[i];

      if (arg === '--continue') {
        continue;
      }

      if (arg === '--resume') {
        // Skip --resume and its value
        if (i + 1 < this._claudeArgs.length && !this._claudeArgs[i + 1].startsWith('-')) {
          i++; // Skip the value too
          continue;
        }
      }

      filteredArgs.push(arg);
    }

    this._claudeArgs = filteredArgs;
  }

  /**
   * Set handler for user input
   */
  onUserInput(handler: (() => void) | null): void {
    this.userInputHandler = handler;
  }

  /**
   * Set handler for switch request
   */
  onSwitch(handler: (() => void) | null): void {
    this.switchHandler = handler;
  }

  /**
   * Set handler for permission response triggering switch (local mode only)
   * When a permission response comes in while in local mode, this triggers switch to remote
   */
  onPermissionResponseTriggerSwitch(handler: (() => void) | null): void {
    this.permissionResponseTriggerSwitch = handler;
  }

  /**
   * Check if there's a pending permission response (from local mode)
   */
  hasPendingPermissionResponse(): boolean {
    return this.pendingPermissionResponse !== null;
  }

  /**
   * Consume the pending permission response (used when switching to remote mode)
   */
  consumePendingPermissionResponse(maxAgeMs: number = 30_000): PermissionResponse | null {
    const pending = this.pendingPermissionResponse;
    if (!pending) return null;

    const ageMs = Date.now() - pending.receivedAt;
    if (ageMs > maxAgeMs) {
      console.log(
        `\x1b[33m⚠️ Clearing stale pending permission response: ${pending.response} (age ${Math.round(ageMs / 1000)}s)\x1b[0m`,
      );
      this.pendingPermissionResponse = null;
      return null;
    }

    this.pendingPermissionResponse = null;
    return pending.response;
  }

  /**
   * Clear any pending permission response (called when new permission request comes in)
   * This prevents stale responses from auto-approving new requests
   * @param maxAgeMs - Clear responses older than this (0 = clear all)
   */
  clearPendingPermissionResponse(maxAgeMs: number = 30_000): void {
    if (!this.pendingPermissionResponse) return;
    
    // If maxAgeMs is 0, always clear (used when new permission request comes in)
    if (maxAgeMs === 0) {
      console.log(
        `\x1b[33m⚠️ Clearing pending permission response for new request: ${this.pendingPermissionResponse.response}\x1b[0m`,
      );
      this.pendingPermissionResponse = null;
      return;
    }
    
    const ageMs = Date.now() - this.pendingPermissionResponse.receivedAt;
    if (ageMs > maxAgeMs) {
      console.log(
        `\x1b[33m⚠️ Clearing stale pending permission response: ${this.pendingPermissionResponse.response} (age ${Math.round(ageMs / 1000)}s)\x1b[0m`,
      );
      this.pendingPermissionResponse = null;
    }
  }

  /**
   * Check if a tool has been "always allowed" for this session
   */
  isToolAlwaysAllowed(toolName: string): boolean {
    // AskUserQuestion must never be auto-approved; it requires explicit user interaction.
    if (toolName === 'AskUserQuestion') return false;
    return this.alwaysAllowedTools.has(toolName);
  }

  /**
   * Mark a tool as "always allowed" for this session
   */
  markToolAlwaysAllowed(toolName: string): void {
    // Never persist "always allow" for AskUserQuestion.
    if (toolName === 'AskUserQuestion') {
      console.log(`\x1b[33m⚠️ Ignoring "always allow" for AskUserQuestion\x1b[0m`);
      return;
    }
    this.alwaysAllowedTools.add(toolName);
    console.log(`\x1b[32m✓ Tool "${toolName}" marked as always allowed for this session\x1b[0m`);
  }

  /**
   * Send Claude event to server
   */
  sendClaudeEvent(event: unknown): void {
    if (this.wsClient) {
      this.wsClient.sendClaudeEvent(event as { type: string }, this.serverSessionId);
    }
  }

  /**
   * Send thinking state to server
   */
  sendThinking(thinking: boolean): void {
    if (this.wsClient) {
      this.wsClient.sendThinking(thinking);
    }
  }

  /**
   * Send mode change to server
   */
  sendModeChange(mode: 'local' | 'remote'): void {
    if (this.wsClient) {
      this.wsClient.sendModeChange(mode);
    }
  }

  /**
   * Send presence state to server
   */
  sendPresence(state: 'active' | 'idle' | 'away'): void {
    if (this.wsClient) {
      this.wsClient.sendPresence(state);
    }
  }

  /**
   * Mark user activity (resets idle timer)
   * Call this when user types, runs commands, etc.
   */
  markActivity(): void {
    if (this.wsClient) {
      this.wsClient.markActivity();
    }
  }

  /**
   * Wait for a permission response from the web UI
   */
  waitForPermissionResponse(): Promise<PermissionResponse> {
    return new Promise((resolve) => {
      this.permissionResolver = resolve;
    });
  }

  /**
   * Close the session
   */
  close(): void {
    this.queue.close();
    if (this.wsClient) {
      this.wsClient.close();
    }
  }
}
