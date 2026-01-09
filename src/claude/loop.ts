/**
 * Mode switching loop - alternates between local and remote modes
 */

import { claudeLocalLauncher } from './claudeLocalLauncher.js';
import { claudeRemoteLauncher } from './claudeRemoteLauncher.js';
import type { Session } from './session.js';

export interface LoopOptions {
  session: Session;
  startingMode?: 'local' | 'remote';
  onModeChange?: (mode: 'local' | 'remote') => void;
  onThinkingChange?: (thinking: boolean) => void;
  /** Called when Claude returns to idle state (waiting for input) */
  onIdle?: () => void;
}

/**
 * Main loop that switches between local and remote modes
 *
 * - Local mode: User interacts directly with Claude via terminal
 * - Remote mode: Messages come from web via WebSocket, processed via SDK
 *
 * Mode switches happen when:
 * - Local → Remote: When a message arrives from web while in local mode
 * - Remote → Local: When user requests switch (e.g., double-space in web UI)
 */
export async function loop(opts: LoopOptions): Promise<void> {
  let mode: 'local' | 'remote' = opts.startingMode ?? 'local';

  while (true) {
    // Notify mode change
    if (opts.onModeChange) {
      opts.onModeChange(mode);
    }

    // Send mode change to server
    opts.session.sendModeChange(mode);

    if (mode === 'local') {
      const reason = await claudeLocalLauncher({
        session: opts.session,
        onThinkingChange: opts.onThinkingChange,
        onIdle: opts.onIdle,
      });

      if (reason === 'exit') {
        return;
      }

      // Switch to remote mode
      mode = 'remote';
      continue;
    }

    if (mode === 'remote') {
      const reason = await claudeRemoteLauncher({
        session: opts.session,
        onThinkingChange: opts.onThinkingChange,
      });

      if (reason === 'exit') {
        return;
      }

      // Switch to local mode
      mode = 'local';
      continue;
    }
  }
}
