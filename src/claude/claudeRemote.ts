/**
 * Remote mode - runs Claude via SDK with streaming responses
 * Messages come from the web via WebSocket
 */

import { query } from './sdk/query.js';
import type { SDKMessage, QueryOptions, PermissionResult, SDKContentBlock } from './sdk/types.js';
import type { ImageAttachment } from '../utils/messageQueue.js';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

/**
 * Pushable async iterable for messages
 */
class PushableAsyncIterable<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waitResolve: ((value: IteratorResult<T>) => void) | null = null;
  private ended = false;

  push(value: T): void {
    if (this.ended) return;

    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ done: false, value });
    } else {
      this.queue.push(value);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waitResolve) {
      const resolve = this.waitResolve;
      this.waitResolve = null;
      resolve({ done: true, value: undefined });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }

      if (this.ended) {
        return;
      }

      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.waitResolve = resolve;
      });

      if (result.done) {
        return;
      }

      yield result.value;
    }
  }
}

export type PermissionResponse = 'yes' | 'no' | 'always';

export interface ClaudeRemoteOptions {
  abort: AbortSignal;
  sessionId: string | null;
  path: string;
  onMessage: (message: SDKMessage) => void;
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  nextMessage: () => Promise<{ message: string; images?: ImageAttachment[] } | null>;
  waitForPermission: (toolName: string) => Promise<PermissionResponse>;
  onPermissionRequest?: (toolName: string, toolInput: unknown) => void;
  claudeArgs?: string[];
}

/**
 * Build SDK content from text and optional images
 */
function buildContent(text: string, images?: ImageAttachment[]): string | SDKContentBlock[] {
  if (!images || images.length === 0) {
    return text;
  }

  // Build content array with images first, then text
  const content: SDKContentBlock[] = [];

  // Add images
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType,
        data: img.data,
      },
    });
  }

  // Add text if present
  if (text) {
    content.push({
      type: 'text',
      text: text,
    });
  }

  return content;
}

/**
 * Get project path for Claude sessions
 * Claude uses the resolved path with special chars replaced by dashes
 */
function getProjectPath(workingDirectory: string): string {
  const projectId = resolve(workingDirectory).replace(/[\\\/.:]/g, '-');
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(claudeConfigDir, 'projects', projectId);
}

/**
 * Check if Claude session exists
 */
function claudeCheckSession(sessionId: string, workingDirectory: string): boolean {
  const projectDir = getProjectPath(workingDirectory);
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);
  return existsSync(sessionFile);
}

/**
 * Run Claude in remote mode using the SDK
 */
export async function claudeRemote(opts: ClaudeRemoteOptions): Promise<string | null> {
  // Determine session to resume
  let startFrom = opts.sessionId;

  // Extract --resume from claudeArgs if present
  if (!startFrom && opts.claudeArgs) {
    for (let i = 0; i < opts.claudeArgs.length; i++) {
      if (opts.claudeArgs[i] === '--resume') {
        if (i + 1 < opts.claudeArgs.length) {
          const nextArg = opts.claudeArgs[i + 1];
          if (!nextArg.startsWith('-') && nextArg.includes('-')) {
            startFrom = nextArg;
          }
        }
      }
    }
  }

  // Validate session exists
  if (startFrom && !claudeCheckSession(startFrom, opts.path)) {
    startFrom = null;
  }

  // Wait for first message
  const firstMessage = await opts.nextMessage();
  if (!firstMessage) {
    return startFrom;
  }

  // Thinking state
  let thinking = false;
  const updateThinking = (newThinking: boolean) => {
    if (thinking !== newThinking) {
      thinking = newThinking;
      if (opts.onThinkingChange) {
        opts.onThinkingChange(thinking);
      }
    }
  };

  // Build SDK options (resume is passed to runQuery separately)
  const sdkOptions: Omit<QueryOptions, 'resume'> = {
    cwd: opts.path,
    abort: opts.abort,
    permissionMode: 'default',
    // Permission callback - notify web UI and wait for response
    canCallTool: async (toolName: string, input: unknown): Promise<PermissionResult> => {
      // Send permission request to web UI (may be skipped if already always-allowed)
      if (opts.onPermissionRequest) {
        opts.onPermissionRequest(toolName, input);
      }

      // Wait for response from web UI (or get auto-approval if always-allowed)
      const response = await opts.waitForPermission(toolName);

      if (response === 'yes' || response === 'always') {
        return {
          behavior: 'allow',
          updatedInput: input as Record<string, unknown>,
        };
      } else {
        return {
          behavior: 'deny',
          message: 'User denied permission',
        };
      }
    },
  };

  // Helper function to run the query loop
  const runQuery = async (
    sessionToResume: string | undefined,
    initialMessage: { message: string; images?: ImageAttachment[] }
  ): Promise<string | null> => {
    // Create fresh pushable stream for messages
    const msgStream = new PushableAsyncIterable<SDKMessage>();

    // Push the initial message
    const initialUserMsg = {
      type: 'user',
      message: { role: 'user', content: buildContent(initialMessage.message, initialMessage.images) },
    };
    msgStream.push(initialUserMsg);
    // Also send to callback so it gets rendered
    opts.onMessage(initialUserMsg);

    const options: QueryOptions = {
      ...sdkOptions,
      resume: sessionToResume,
    };

    const response = query({
      prompt: msgStream,
      options,
    });

    updateThinking(true);

    console.error('\x1b[90m[debug] Starting message loop\x1b[0m');
    let messageCount = 0;

    for await (const message of response) {
      messageCount++;
      console.error(`\x1b[90m[debug] Message #${messageCount}: type=${message.type}${message.subtype ? `, subtype=${message.subtype}` : ''}\x1b[0m`);

      // Forward message to callback
      opts.onMessage(message);

      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        updateThinking(true);

        // Extract session ID
        if ('session_id' in message && typeof message.session_id === 'string') {
          opts.onSessionFound(message.session_id);
        }
      }

      if (message.type === 'result') {
        console.error('\x1b[90m[debug] Got result, waiting for next user message...\x1b[0m');
        updateThinking(false);

        // Get next message
        const next = await opts.nextMessage();
        if (!next) {
          console.error('\x1b[90m[debug] No next message, ending stream\x1b[0m');
          msgStream.end();
          return sessionToResume ?? null;
        }

        console.error(`\x1b[90m[debug] Got next message: "${next.message.slice(0, 50)}..."\x1b[0m`);

        // Push next message (with optional images)
        const nextUserMsg = {
          type: 'user',
          message: { role: 'user', content: buildContent(next.message, next.images) },
        };
        msgStream.push(nextUserMsg);
        // Also send to callback so it gets rendered
        opts.onMessage(nextUserMsg);
      }
    }

    console.error(`\x1b[90m[debug] Message loop ended after ${messageCount} messages\x1b[0m`);

    return sessionToResume ?? null;
  };

  try {
    return await runQuery(startFrom ?? undefined, firstMessage);
  } catch (e) {
    // If resume failed and we were trying to resume, try starting fresh
    if (startFrom && !opts.abort.aborted) {
      console.log(`[remote] Could not resume session ${startFrom}, starting fresh`);
      try {
        return await runQuery(undefined, firstMessage);
      } catch (e2) {
        if (!opts.abort.aborted) {
          console.error('[remote] Error starting fresh session:', e2);
        }
      }
    } else if (!opts.abort.aborted) {
      console.error('[remote] Error:', e);
    }
  } finally {
    updateThinking(false);
  }

  return startFrom;
}
