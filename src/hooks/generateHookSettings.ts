/**
 * Generate temporary settings file with Claude hooks for session tracking
 *
 * Creates a settings.json file that configures Claude's SessionStart hook
 * to notify our HTTP server when sessions change (new session, resume, compact, etc.)
 */

import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the project root directory (cli folder)
 */
function getProjectRoot(): string {
  // From dist/hooks/generateHookSettings.js, go up to cli/
  return join(__dirname, '..', '..');
}

/**
 * Get the hooks temp directory path
 */
function getHooksDir(): string {
  return join(homedir(), '.anyware', 'tmp', 'hooks');
}

/**
 * Generate a temporary settings file with SessionStart hook configuration
 *
 * @param port - The port where the hook server is listening
 * @returns Path to the generated settings file
 */
export function generateHookSettingsFile(port: number): string {
  const hooksDir = getHooksDir();
  mkdirSync(hooksDir, { recursive: true });

  // Unique filename per process to avoid conflicts
  const filename = `session-hook-${process.pid}.json`;
  const filepath = join(hooksDir, filename);

  // Path to the hook forwarder script
  const forwarderScript = join(getProjectRoot(), 'scripts', 'session_hook_forwarder.cjs');
  const hookCommand = `node "${forwarderScript}" ${port}`;

  const settings = {
    hooks: {
      SessionStart: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
      PermissionRequest: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: hookCommand,
            },
          ],
        },
      ],
    },
  };

  writeFileSync(filepath, JSON.stringify(settings, null, 2));

  return filepath;
}

/**
 * Clean up the temporary hook settings file
 *
 * @param filepath - Path to the settings file to remove
 */
export function cleanupHookSettingsFile(filepath: string): void {
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
