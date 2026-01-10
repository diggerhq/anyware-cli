import { claudeLocal } from './claudeLocal.js';
import { createSessionScanner } from './sessionScanner.js';
import type { Session } from './session.js';
import { startHookServer, HookEventType, HookData } from '../hooks/hookServer.js';
import { generateHookSettingsFile, cleanupHookSettingsFile } from '../hooks/generateHookSettings.js';

export type LocalExitReason = 'switch' | 'exit';

export interface LocalLauncherOptions {
  session: Session;
  onThinkingChange?: (thinking: boolean) => void;
  /** Called when Claude finishes responding (idle state) */
  onIdle?: () => void;
}

/**
 * Launch Claude in local mode with session scanning
 * Returns 'switch' if we should switch to remote mode, 'exit' if we should exit
 */
export async function claudeLocalLauncher(opts: LocalLauncherOptions): Promise<LocalExitReason> {
  const { session, onThinkingChange, onIdle } = opts;
  // Variable to hold scanner reference (needed in onHookEvent before scanner is created)
  let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;

  // Start hook server to receive session notifications from Claude
  const hookServer = await startHookServer({
    onSessionHook: (sessionId) => {
      session.setClaudeSessionId(sessionId);
      if (scanner) {
        scanner.onNewSession(sessionId);
      }
    },
    onHookEvent: (eventType: HookEventType, _sessionId: string, data: HookData) => {
      // Forward hook events to the WebSocket as claude_event
      // Transform hook data to the expected format
      const claudeEvent = {
        type: eventType,
        hook_data: {
          tool_name: data.tool_name,
          tool_input: data.tool_input,
          tool_response: data.tool_response,
          prompt: data.prompt,
          stop_reason: data.stop_reason,
          response: data.response,
          cwd: data.cwd,
        },
        session_id: data.session_id,
      };
      session.sendClaudeEvent(claudeEvent);
    },
  });

  // Generate hook settings file for Claude
  const hookSettingsPath = generateHookSettingsFile(hookServer.port);

  // Create scanner to watch session file and forward messages to server
  scanner = await createSessionScanner({
    sessionId: session.claudeSessionId,
    workingDirectory: session.path,
    onMessage: (message) => {
      // Skip summary messages - we generate our own
      if (message.type !== 'summary') {
        session.sendClaudeEvent(message);
      }
    },
    onIdle,
  });

  // Register callback for when session ID is discovered (from other sources)
  const scannerSessionCallback = (sessionId: string) => {
    scanner.onNewSession(sessionId);
  };
  session.addSessionFoundCallback(scannerSessionCallback);

  let exitReason: LocalExitReason | null = null;
  const processAbortController = new AbortController();

  // Use a deferred pattern for exit promise
  let exitResolve: () => void = () => {};
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });

  try {
    // Abort function
    async function abort() {
      if (!processAbortController.signal.aborted) {
        processAbortController.abort();
      }
      await exitPromise;
    }

    // Handle abort request (switch to remote)
    async function doAbort() {
      if (!exitReason) {
        exitReason = 'switch';
      }
      session.queue.reset();
      await abort();
    }

    // Handle switch request
    async function doSwitch() {
      if (!exitReason) {
        exitReason = 'switch';
      }
      await abort();
    }

    // Register handlers for incoming messages
    session.onUserInput(() => {
      // Any user input from web triggers switch to remote mode
      doSwitch();
    });

    session.onSwitch(() => {
      doSwitch();
    });

    // When a permission response comes from web while in local mode,
    // switch to remote mode to handle it
    session.onPermissionResponseTriggerSwitch(() => {
      console.log('\n\x1b[36mPermission response received from web, switching to remote mode...\x1b[0m\n');
      doSwitch();
    });

    // If there are already messages in the queue, switch to remote immediately
    if (session.queue.size() > 0) {
      return 'switch';
    }

    // Handle session start
    const handleSessionStart = (sessionId: string) => {
      session.setClaudeSessionId(sessionId);
      scanner.onNewSession(sessionId);
    };

    // Run local mode loop
    while (true) {
      if (exitReason) {
        return exitReason;
      }

      try {
        await claudeLocal({
          path: session.path,
          sessionId: session.claudeSessionId,
          onSessionFound: handleSessionStart,
          onThinkingChange: (thinking) => {
            session.sendThinking(thinking);
            if (onThinkingChange) {
              onThinkingChange(thinking);
            }
          },
          abort: processAbortController.signal,
          claudeArgs: session.claudeArgs,
          hookSettingsPath,
        });

        // Consume one-time flags after first spawn
        session.consumeOneTimeFlags();

        // Normal exit
        if (!exitReason) {
          exitReason = 'exit';
          break;
        }
      } catch {
        if (!exitReason) {
          // Retry on error
          continue;
        } else {
          break;
        }
      }
    }
  } finally {
    // Resolve exit promise
    exitResolve();

    // Cleanup handlers
    session.onUserInput(null);
    session.onSwitch(null);
    session.onPermissionResponseTriggerSwitch(null);
    session.removeSessionFoundCallback(scannerSessionCallback);

    // Cleanup scanner
    await scanner.cleanup();

    // Cleanup hook server and settings file
    hookServer.stop();
    cleanupHookSettingsFile(hookSettingsPath);
  }

  return exitReason || 'exit';
}
