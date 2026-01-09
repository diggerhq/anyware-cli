import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface ClaudeLocalOptions {
  abort: AbortSignal;
  sessionId: string | null;
  path: string;
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  claudeArgs?: string[];
  /** Path to temporary settings file with SessionStart hook (required for session tracking) */
  hookSettingsPath: string;
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
 * Check if a Claude session exists
 */
function claudeCheckSession(sessionId: string, workingDirectory: string): boolean {
  const projectDir = getProjectPath(workingDirectory);
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);
  return existsSync(sessionFile);
}

/**
 * Find the claude binary path
 */
function findClaudePath(): string {
  // Try common locations
  const paths = [
    join(homedir(), '.claude', 'local', 'claude'), // Claude Code default install location
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.npm-global', 'bin', 'claude'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Fall back to PATH
  return 'claude';
}

/**
 * Spawn Claude Code in local (interactive) mode
 * - Uses inherited stdio so user can interact directly
 * - Uses fd3 pipe for thinking state tracking (optional)
 */
export async function claudeLocal(opts: ClaudeLocalOptions): Promise<string | null> {
  // Ensure project directory exists
  const projectDir = getProjectPath(opts.path);
  mkdirSync(projectDir, { recursive: true });

  // Check if claudeArgs contains --continue or --resume
  const hasContinueFlag = opts.claudeArgs?.includes('--continue');
  const hasResumeFlag = opts.claudeArgs?.includes('--resume');
  const hasUserSessionControl = hasContinueFlag || hasResumeFlag;

  // Determine if we have an existing session to resume
  let startFrom = opts.sessionId;
  if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
    startFrom = null;
  }


  // Thinking state tracking
  let thinking = false;
  let stopThinkingTimeout: NodeJS.Timeout | null = null;

  const updateThinking = (newThinking: boolean) => {
    if (thinking !== newThinking) {
      thinking = newThinking;
      if (opts.onThinkingChange) {
        opts.onThinkingChange(thinking);
      }
    }
  };

  const claudePath = findClaudePath();

  try {
    process.stdin.pause();

    await new Promise<void>((resolve, reject) => {
      const args: string[] = [];

      // Only add --resume if we have an existing session and user didn't pass their own flags
      if (!hasUserSessionControl && startFrom) {
        args.push('--resume', startFrom);
      }

      // Add custom Claude arguments
      if (opts.claudeArgs) {
        args.push(...opts.claudeArgs);
      }

      // Add hook settings for session tracking (always passed)
      args.push('--settings', opts.hookSettingsPath);

      const child = spawn(claudePath, args, {
        stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
        signal: opts.abort,
        cwd: opts.path,
        env: process.env,
      });

      // Listen to fd3 for thinking state tracking (if available)
      if (child.stdio[3]) {
        const rl = createInterface({
          input: child.stdio[3] as NodeJS.ReadableStream,
          crlfDelay: Infinity,
        });

        const activeFetches = new Map<number, { hostname: string; path: string; startTime: number }>();

        rl.on('line', (line) => {
          try {
            const message = JSON.parse(line);

            switch (message.type) {
              case 'fetch-start':
                activeFetches.set(message.id, {
                  hostname: message.hostname,
                  path: message.path,
                  startTime: message.timestamp,
                });

                if (stopThinkingTimeout) {
                  clearTimeout(stopThinkingTimeout);
                  stopThinkingTimeout = null;
                }

                updateThinking(true);
                break;

              case 'fetch-end':
                activeFetches.delete(message.id);

                if (activeFetches.size === 0 && thinking && !stopThinkingTimeout) {
                  stopThinkingTimeout = setTimeout(() => {
                    if (activeFetches.size === 0) {
                      updateThinking(false);
                    }
                    stopThinkingTimeout = null;
                  }, 500);
                }
                break;
            }
          } catch {
            // Ignore non-JSON lines
          }
        });

        rl.on('error', (err) => {
          console.error('[local] Error reading fd3:', err);
        });

        child.on('exit', () => {
          if (stopThinkingTimeout) {
            clearTimeout(stopThinkingTimeout);
          }
          updateThinking(false);
        });
      }

      child.on('error', (error: Error & { code?: string }) => {
        // Ignore abort errors - they're expected when switching modes
        if (error.code !== 'ABORT_ERR' && error.name !== 'AbortError') {
          console.error('[local] Spawn error:', error);
        }
      });

      child.on('exit', (code, signal) => {
        if (signal === 'SIGTERM' && opts.abort.aborted) {
          resolve();
        } else if (signal) {
          reject(new Error(`Process terminated with signal: ${signal}`));
        } else {
          resolve();
        }
      });
    });
  } finally {
    process.stdin.resume();
    if (stopThinkingTimeout) {
      clearTimeout(stopThinkingTimeout);
    }
    updateThinking(false);
  }

  return startFrom;
}
