import { watch } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

// Schema for JSONL messages from Claude Code session files
// Uses passthrough() to allow additional fields that Claude Code adds
const UserMessageSchema = z.object({
  type: z.literal('user'),
  uuid: z.string(),
  message: z.object({
    content: z.unknown(),
  }).passthrough(),
}).passthrough();

const AssistantMessageSchema = z.object({
  type: z.literal('assistant'),
  uuid: z.string(),
  message: z.object({
    content: z.unknown(),
  }).passthrough().optional(),
}).passthrough();

const SystemMessageSchema = z.object({
  type: z.literal('system'),
  uuid: z.string(),
}).passthrough();

const SummaryMessageSchema = z.object({
  type: z.literal('summary'),
  leafUuid: z.string(),
  summary: z.string(),
}).passthrough();

const RawJSONLinesSchema = z.discriminatedUnion('type', [
  UserMessageSchema,
  AssistantMessageSchema,
  SystemMessageSchema,
  SummaryMessageSchema,
]);

export type RawJSONLines = z.infer<typeof RawJSONLinesSchema>;

// Internal Claude Code event types to skip
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
  'file-history-snapshot',
  'change',
  'queue-operation',
]);

export interface SessionScannerOptions {
  sessionId: string | null;
  workingDirectory: string;
  onMessage: (message: RawJSONLines) => void;
  /** Called when Claude finishes responding (assistant message received) */
  onIdle?: () => void;
}

export interface SessionScanner {
  cleanup: () => Promise<void>;
  onNewSession: (sessionId: string) => void;
}

/**
 * Get the project path for Claude Code sessions
 * Claude uses the resolved path with special chars replaced by dashes
 */
function getProjectPath(workingDirectory: string): string {
  const projectId = resolve(workingDirectory).replace(/[\\\/.:]/g, '-');
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(claudeConfigDir, 'projects', projectId);
}

/**
 * Generate a unique key for a message to track if we've processed it
 */
function messageKey(message: RawJSONLines): string {
  if (message.type === 'user') {
    return message.uuid;
  } else if (message.type === 'assistant') {
    return message.uuid;
  } else if (message.type === 'summary') {
    return `summary:${message.leafUuid}:${message.summary}`;
  } else if (message.type === 'system') {
    return message.uuid;
  }
  return '';
}

/**
 * Read and parse a session JSONL file
 */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);

  if (!existsSync(sessionFile)) {
    return [];
  }

  try {
    const content = await readFile(sessionFile, 'utf-8');
    const lines = content.split('\n');
    const messages: RawJSONLines[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        // Skip internal events
        if (parsed.type && INTERNAL_CLAUDE_EVENT_TYPES.has(parsed.type)) {
          continue;
        }

        const result = RawJSONLinesSchema.safeParse(parsed);
        if (result.success) {
          messages.push(result.data);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Create a session scanner that watches Claude Code session files
 * and forwards new messages via the onMessage callback
 */
export async function createSessionScanner(opts: SessionScannerOptions): Promise<SessionScanner> {
  const projectDir = getProjectPath(opts.workingDirectory);

  // Track which messages we've already processed
  const processedMessageKeys = new Set<string>();
  let currentSessionId = opts.sessionId;
  let watcher: ReturnType<typeof watch> | null = null;
  let syncTimeout: NodeJS.Timeout | null = null;

  /**
   * Sync function - reads session files and sends new messages
   */
  async function sync() {
    if (!currentSessionId) {
      return;
    }

    const messages = await readSessionLog(projectDir, currentSessionId);
    let sawAssistantMessage = false;

    for (const message of messages) {
      const key = messageKey(message);
      if (processedMessageKeys.has(key)) {
        continue;
      }

      processedMessageKeys.add(key);
      opts.onMessage(message);

      // Track if we processed an assistant message (Claude finished responding)
      if (message.type === 'assistant') {
        sawAssistantMessage = true;
      }
    }

    // Notify idle state after processing all messages
    if (sawAssistantMessage && opts.onIdle) {
      opts.onIdle();
    }
  }

  /**
   * Debounced sync - waits a bit before syncing to batch file changes
   */
  function scheduleSync() {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(() => {
      sync().catch(console.error);
    }, 100);
  }

  // Mark existing messages as processed if we have an initial session
  if (opts.sessionId) {
    const existingMessages = await readSessionLog(projectDir, opts.sessionId);
    for (const message of existingMessages) {
      processedMessageKeys.add(messageKey(message));
    }

    // Start watching the session file
    const sessionFile = join(projectDir, `${opts.sessionId}.jsonl`);
    watcher = watch(sessionFile, {
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', scheduleSync);
    watcher.on('add', scheduleSync);
  }

  // Periodic sync as backup (every 3 seconds)
  const intervalId = setInterval(scheduleSync, 3000);

  return {
    cleanup: async () => {
      clearInterval(intervalId);
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
      if (watcher) {
        await watcher.close();
      }
    },

    onNewSession: (sessionId: string) => {
      if (sessionId === currentSessionId) {
        return;
      }

      currentSessionId = sessionId;

      // Stop watching old file, start watching new one
      if (watcher) {
        watcher.close();
      }

      const sessionFile = join(projectDir, `${sessionId}.jsonl`);

      watcher = watch(sessionFile, {
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('change', scheduleSync);
      watcher.on('add', scheduleSync);

      // Immediate sync for new session
      scheduleSync();
    },
  };
}
