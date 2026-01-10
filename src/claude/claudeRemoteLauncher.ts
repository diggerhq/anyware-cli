/**
 * Remote launcher - handles remote mode execution with session management
 */

import { claudeRemote } from './claudeRemote.js';
import type { Session } from './session.js';
import { createTerminalRenderer } from './terminalRenderer.js';
import * as readline from 'node:readline';

export type RemoteExitReason = 'switch' | 'exit';

export interface RemoteLauncherOptions {
  session: Session;
  onThinkingChange?: (thinking: boolean) => void;
}

/**
 * Launch Claude in remote mode
 * Returns 'switch' if we should switch to local mode, 'exit' if we should exit
 */
export async function claudeRemoteLauncher(opts: RemoteLauncherOptions): Promise<RemoteExitReason> {
  const { session, onThinkingChange } = opts;
  let exitReason: RemoteExitReason | null = null;
  const processAbortController = new AbortController();

  // Setup keyboard listener for switching back to local mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Listen for any keypress to switch back to local
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const keypressHandler = (str: string, key: readline.Key) => {
    // Switch to local on Enter, Escape, or 'q'
    if (key.name === 'return' || key.name === 'escape' || str === 'q') {
      if (!exitReason) {
        exitReason = 'switch';
      }
      session.queue.reset(); // Unblock waitForMessage
      processAbortController.abort();
    }
    // Ctrl+C to exit completely
    if (key.ctrl && key.name === 'c') {
      if (!exitReason) {
        exitReason = 'exit';
      }
      session.queue.reset(); // Unblock waitForMessage
      processAbortController.abort();
    }
  };

  process.stdin.on('keypress', keypressHandler);

  // Create terminal renderer for displaying messages
  const renderer = createTerminalRenderer();

  try {
    // Handle switch request from web (user wants to go back to local mode)
    session.onSwitch(() => {
      if (!exitReason) {
        exitReason = 'switch';
      }
      session.queue.reset(); // Unblock waitForMessage
      processAbortController.abort();
    });

    // If we have a pending permission response (from local mode) and no messages in queue,
    // queue a "continue" message to trigger Claude to resume.
    // NOTE: Don't do this if there's already a message in queue - that handles AskUserQuestion
    // where the user's selection is sent as user_input.
    if (session.hasPendingPermissionResponse() && session.queue.size() === 0) {
      console.log('\x1b[90m[remote] Pending permission response detected, queueing "continue" to resume Claude\x1b[0m');
      session.queue.push('continue');
    }

    // Run remote mode
    console.log('');
    console.log('\x1b[36m\x1b[1mRemote Mode Active\x1b[0m');
    console.log('\x1b[90mMessages from web will appear here. Press Enter/q to switch to local, Ctrl+C to exit.\x1b[0m');
    console.log('');

    await claudeRemote({
      path: session.path,
      sessionId: session.claudeSessionId,
      abort: processAbortController.signal,
      claudeArgs: session.claudeArgs,
      onMessage: (message) => {
        // Render message in terminal
        renderer.render(message);

        // Forward SDK messages to server
        session.sendClaudeEvent(message);
      },
      onSessionFound: (sessionId) => {
        session.setClaudeSessionId(sessionId);
      },
      onThinkingChange: (thinking) => {
        // Show/hide thinking indicator in terminal
        if (thinking) {
          renderer.showThinking();
        } else {
          renderer.clearThinking();
        }
        session.sendThinking(thinking);
        if (onThinkingChange) {
          onThinkingChange(thinking);
        }
      },
      nextMessage: async () => {
        // Wait for next message from queue (includes optional images)
        const queueMsg = await session.queue.waitForMessage();

        if (!queueMsg) {
          // Queue was reset or closed
          return null;
        }

        return { message: queueMsg.message, images: queueMsg.images };
      },
      waitForPermission: async (toolName: string) => {
        // Check if tool is already "always allowed"
        if (session.isToolAlwaysAllowed(toolName)) {
          console.log(`\x1b[32m✓ Auto-approved: ${toolName} (always allowed)\x1b[0m`);
          return 'always';
        }

        // Check if there's a pending permission response from local mode switch
        const pending = session.consumePendingPermissionResponse();
        if (pending) {
          console.log(`\x1b[32m✓ Using pending permission response: ${pending}\x1b[0m`);
          if (pending === 'always') {
            session.markToolAlwaysAllowed(toolName);
          }
          return pending;
        }

        // Otherwise wait for new response from web
        const response = await session.waitForPermissionResponse();

        // If user selected "always", remember it for this session
        if (response === 'always') {
          session.markToolAlwaysAllowed(toolName);
        }

        return response;
      },
      onPermissionRequest: (toolName, toolInput) => {
        // If tool is already "always allowed", don't show permission request
        if (session.isToolAlwaysAllowed(toolName)) {
          return;
        }

        // IMPORTANT: Clear ALL pending permission responses before requesting new permission
        // This prevents an OLD response from being consumed by the NEW request
        // (e.g., user approved Bash 20s ago, now Edit is asking - shouldn't auto-approve Edit)
        session.clearPendingPermissionResponse(0);

        // Extra safety: AskUserQuestion should never be auto-answered by a stale queued message
        // (e.g. an old "proceed" sitting in the queue from a previous UI bug).
        if (toolName === 'AskUserQuestion') {
          session.queue.reset();
        }

        // Send permission request event to web UI
        const permissionEvent = {
          type: 'PermissionRequest',
          hook_data: {
            tool_name: toolName,
            tool_input: toolInput,
          },
        };
        session.sendClaudeEvent(permissionEvent);

        // Also render in terminal
        console.log('');
        console.log('\x1b[33m⚠️  Permission Required\x1b[0m');
        console.log(`\x1b[90mTool: ${toolName}\x1b[0m`);
        console.log('\x1b[90mWaiting for approval from web UI...\x1b[0m');
      },
    });

    // Consume one-time flags after spawn
    session.consumeOneTimeFlags();

    // Normal exit if no exit reason set
    if (!exitReason) {
      exitReason = 'exit';
    }
  } catch (e) {
    console.error('[remote] Error:', e);
    if (!exitReason) {
      exitReason = 'exit';
    }
  } finally {
    // Cleanup keyboard listener
    process.stdin.removeListener('keypress', keypressHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    rl.close();

    // Cleanup handlers
    session.onSwitch(null);
  }

  return exitReason;
}
