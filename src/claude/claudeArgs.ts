/**
 * Claude Code argument validation
 * Defines valid arguments that can be passed through to Claude Code
 */

// Arguments that take no value (flags)
export const CLAUDE_FLAG_ARGS = new Set([
  '--debug',
  '-d',
  '--verbose',
  '--print',
  '-p',
  '--include-partial-messages',
  '--mcp-debug',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--replay-user-messages',
  '--continue',
  '-c',
  '--fork-session',
  '--no-session-persistence',
  '--ide',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--chrome',
  '--no-chrome',
]);

// Arguments that require a value
export const CLAUDE_VALUE_ARGS = new Set([
  '--output-format',
  '--json-schema',
  '--input-format',
  '--max-budget-usd',
  '--allowedTools',
  '--allowed-tools',
  '--tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--mcp-config',
  '--system-prompt',
  '--append-system-prompt',
  '--permission-mode',
  '--resume',
  '-r',
  '--model',
  '--agent',
  '--betas',
  '--fallback-model',
  '--settings',
  '--add-dir',
  '--session-id',
  '--agents',
  '--setting-sources',
  '--plugin-dir',
]);

// Arguments that anyware handles specially and should be filtered
export const ANYWARE_HANDLED_ARGS = new Set([
  '--model',        // anyware handles model via its own flag
  '--resume',       // anyware handles resume
  '-r',
  '--continue',     // anyware handles continue
  '-c',
  '--settings',     // anyware injects its own settings for hooks
]);

// All valid Claude args
export const ALL_CLAUDE_ARGS = new Set([
  ...CLAUDE_FLAG_ARGS,
  ...CLAUDE_VALUE_ARGS,
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validArgs: string[];
}

/**
 * Validate Claude Code arguments
 * @param args Array of arguments to validate
 * @param allowHandledArgs If true, allows anyware-handled args (they'll pass through)
 * @returns Validation result with errors, warnings, and filtered valid args
 */
export function validateClaudeArgs(args: string[], allowHandledArgs = false): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validArgs: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Check if it's a valid flag or value arg
    if (CLAUDE_FLAG_ARGS.has(arg)) {
      // It's a flag - check if anyware handles it
      if (ANYWARE_HANDLED_ARGS.has(arg) && !allowHandledArgs) {
        warnings.push(`'${arg}' is handled by anyware. Use anyware's own option instead.`);
      } else {
        validArgs.push(arg);
      }
      i++;
    } else if (CLAUDE_VALUE_ARGS.has(arg)) {
      // It's a value arg - needs a following value
      if (i + 1 >= args.length) {
        errors.push(`'${arg}' requires a value`);
        i++;
      } else {
        const value = args[i + 1];
        // Check if the value looks like another flag
        if (value.startsWith('-') && !value.match(/^-?\d/)) {
          errors.push(`'${arg}' requires a value, but got '${value}'`);
          i++;
        } else {
          // Check if anyware handles it
          if (ANYWARE_HANDLED_ARGS.has(arg) && !allowHandledArgs) {
            warnings.push(`'${arg}' is handled by anyware. Use anyware's own option instead.`);
          } else {
            validArgs.push(arg, value);
          }
          i += 2;
        }
      }
    } else if (arg.startsWith('-')) {
      // Unknown flag/option
      errors.push(`Unknown Claude Code argument: '${arg}'`);
      i++;
    } else {
      // Positional argument - Claude accepts a prompt as positional
      validArgs.push(arg);
      i++;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    validArgs,
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push('Invalid Claude Code arguments:');
    for (const error of result.errors) {
      lines.push(`  ✗ ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get help text showing valid Claude Code arguments
 */
export function getClaudeArgsHelp(): string {
  return `
Valid Claude Code arguments (pass after --):

Flags (no value required):
  --debug, -d              Enable debug mode
  --verbose                Override verbose mode setting
  --print, -p              Print response and exit
  --include-partial-messages
  --dangerously-skip-permissions
  --allow-dangerously-skip-permissions
  --replay-user-messages
  --fork-session           Create new session ID when resuming
  --no-session-persistence Disable session persistence
  --ide                    Auto-connect to IDE
  --strict-mcp-config      Only use MCP servers from --mcp-config
  --disable-slash-commands Disable slash commands
  --chrome / --no-chrome   Enable/disable Chrome integration

Options (require a value):
  --output-format <format> text, json, or stream-json
  --input-format <format>  text or stream-json
  --json-schema <schema>   JSON Schema for structured output
  --max-budget-usd <amount>
  --allowed-tools <tools>  Tools to allow
  --disallowed-tools <tools> Tools to deny
  --tools <tools>          Available tools from built-in set
  --mcp-config <config>    MCP server configuration
  --system-prompt <prompt>
  --append-system-prompt <prompt>
  --permission-mode <mode> acceptEdits, bypassPermissions, default, delegate, dontAsk, plan
  --agent <agent>          Agent for the session
  --betas <betas>          Beta headers
  --fallback-model <model>
  --add-dir <dirs>         Additional directories
  --session-id <uuid>      Specific session ID
  --agents <json>          Custom agents JSON
  --setting-sources <sources>
  --plugin-dir <paths>     Plugin directories

Note: --model, --resume, --continue are handled by anyware directly.

Example:
  anyware run -- --permission-mode=bypassPermissions --verbose
`;
}

