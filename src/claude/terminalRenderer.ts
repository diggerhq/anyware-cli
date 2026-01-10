/**
 * Terminal renderer for SDK messages
 * Displays Claude Code output in the terminal during remote mode
 */

import type { SDKMessage } from './sdk/types.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

// Tool icons (matching Claude Code style)
const toolIcons: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  Bash: '⚡',
  Glob: '🔍',
  Grep: '🔍',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Task: '📋',
  TodoWrite: '📝',
  AskUserQuestion: '❓',
  default: '🔧',
};

/**
 * Get icon for a tool
 */
function getToolIcon(toolName: string): string {
  return toolIcons[toolName] || toolIcons.default;
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * Get filename from path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Format tool description for display
 */
function getToolDescription(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
      return `Reading ${getFileName(inp.file_path as string || '')}`;
    case 'Write':
      return `Writing to ${getFileName(inp.file_path as string || '')}`;
    case 'Edit':
      return `Editing ${getFileName(inp.file_path as string || '')}`;
    case 'Bash':
      return `$ ${truncate(inp.command as string || '', 60)}`;
    case 'Glob':
      return `Searching for ${inp.pattern as string || ''}`;
    case 'Grep':
      return `Searching for "${truncate(inp.pattern as string || '', 30)}"`;
    case 'WebFetch':
      try {
        const url = new URL(inp.url as string);
        return `Fetching ${url.hostname}`;
      } catch {
        return `Fetching ${truncate(inp.url as string || '', 40)}`;
      }
    case 'WebSearch':
      return `Searching: ${truncate(inp.query as string || '', 40)}`;
    case 'Task':
      return `Spawning agent: ${inp.description as string || ''}`;
    case 'TodoWrite':
      return 'Updating task list';
    case 'AskUserQuestion':
      return 'Asking question';
    default:
      return `Using ${toolName}`;
  }
}

/**
 * Render a horizontal line
 */
function renderLine(char = '─', width = 60): string {
  return colors.dim + char.repeat(width) + colors.reset;
}

/**
 * Terminal renderer class
 */
export class TerminalRenderer {
  private lastMessageType: string | null = null;
  private isShowingThinking = false;

  /**
   * Render an SDK message to the terminal
   */
  render(message: SDKMessage): void {
    // Clear thinking indicator if showing
    if (this.isShowingThinking) {
      this.clearThinking();
    }

    switch (message.type) {
      case 'system':
        this.renderSystem(message);
        break;
      case 'user':
        this.renderUser(message);
        break;
      case 'assistant':
        this.renderAssistant(message);
        break;
      case 'result':
        this.renderResult(message);
        break;
      default:
        // Skip other message types (control_response, etc.)
        break;
    }

    this.lastMessageType = message.type;
  }

  /**
   * Render system message (session init)
   */
  private renderSystem(message: SDKMessage): void {
    const subtype = message.subtype as string;

    if (subtype === 'init') {
      const sessionId = message.session_id as string;
      const model = message.model as string;
      const cwd = message.cwd as string;

      console.log('');
      console.log(`${colors.cyan}${colors.bold}Session Started${colors.reset}`);
      if (sessionId) {
        console.log(`${colors.dim}Session: ${sessionId.slice(0, 8)}...${colors.reset}`);
      }
      if (model) {
        console.log(`${colors.dim}Model: ${model}${colors.reset}`);
      }
      if (cwd) {
        console.log(`${colors.dim}Directory: ${cwd}${colors.reset}`);
      }
      console.log(renderLine());
    }
  }

  /**
   * Render user message
   */
  private renderUser(message: SDKMessage): void {
    const msg = message.message as { content: string | Array<{ type: string; text?: string }> };
    if (!msg) return;

    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
    }

    if (!text) return;

    console.log('');
    console.log(`${colors.blue}${colors.bold}You${colors.reset}`);
    console.log(text);
  }

  /**
   * Render assistant message (text + tool calls)
   */
  private renderAssistant(message: SDKMessage): void {
    const msg = message.message as {
      content: Array<{
        type: string;
        text?: string;
        name?: string;
        input?: unknown;
        id?: string;
      }>;
    };

    if (!msg?.content) return;

    let hasOutput = false;

    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        if (!hasOutput) {
          console.log('');
          console.log(`${colors.green}${colors.bold}Claude${colors.reset}`);
          hasOutput = true;
        }
        console.log(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        const icon = getToolIcon(block.name);
        const description = getToolDescription(block.name, block.input);

        console.log('');
        console.log(`${colors.yellow}${icon} ${block.name}${colors.reset}`);
        console.log(`${colors.dim}${description}${colors.reset}`);

        // Show additional details for certain tools
        this.renderToolDetails(block.name, block.input);
      }
    }
  }

  /**
   * Render tool-specific details
   */
  private renderToolDetails(toolName: string, input: unknown): void {
    const inp = input as Record<string, unknown>;

    if (toolName === 'Edit' && inp.file_path) {
      const oldStr = (inp.old_string as string) || '';
      const newStr = (inp.new_string as string) || '';

      if (oldStr || newStr) {
        // Show diff preview
        const oldLines = oldStr.split('\n').slice(0, 3);
        const newLines = newStr.split('\n').slice(0, 3);

        if (oldLines.length > 0 && oldLines[0]) {
          for (const line of oldLines) {
            console.log(`${colors.red}- ${truncate(line, 70)}${colors.reset}`);
          }
          if (oldStr.split('\n').length > 3) {
            console.log(`${colors.dim}  ... (${oldStr.split('\n').length - 3} more lines)${colors.reset}`);
          }
        }

        if (newLines.length > 0 && newLines[0]) {
          for (const line of newLines) {
            console.log(`${colors.green}+ ${truncate(line, 70)}${colors.reset}`);
          }
          if (newStr.split('\n').length > 3) {
            console.log(`${colors.dim}  ... (${newStr.split('\n').length - 3} more lines)${colors.reset}`);
          }
        }
      }
    }
  }

  /**
   * Render result message
   */
  private renderResult(message: SDKMessage): void {
    const subtype = message.subtype as string;
    const numTurns = message.num_turns as number;
    const cost = message.total_cost_usd as number;
    const duration = message.duration_ms as number;
    const isError = message.is_error as boolean;

    console.log('');
    console.log(renderLine());

    if (isError) {
      console.log(`${colors.red}${colors.bold}Error${colors.reset}`);
      if (message.result) {
        console.log(`${colors.red}${message.result}${colors.reset}`);
      }
    } else {
      const statusIcon = subtype === 'success' ? '✓' : '⚠';
      const statusColor = subtype === 'success' ? colors.green : colors.yellow;

      console.log(`${statusColor}${statusIcon} Completed${colors.reset}`);
    }

    // Stats line
    const stats: string[] = [];
    if (numTurns) stats.push(`${numTurns} turn${numTurns > 1 ? 's' : ''}`);
    if (duration) stats.push(`${(duration / 1000).toFixed(1)}s`);
    if (cost) stats.push(`$${cost.toFixed(4)}`);

    if (stats.length > 0) {
      console.log(`${colors.dim}${stats.join(' · ')}${colors.reset}`);
    }
  }

  /**
   * Show a "thinking" indicator
   */
  showThinking(): void {
    if (!this.isShowingThinking) {
      this.isShowingThinking = true;
      process.stdout.write(`${colors.dim}Thinking...${colors.reset}`);
    }
  }

  /**
   * Clear the thinking indicator
   */
  clearThinking(): void {
    if (this.isShowingThinking) {
      this.isShowingThinking = false;
      // Move cursor to beginning of line and clear
      process.stdout.write('\r\x1b[K');
    }
  }
}

/**
 * Create a new terminal renderer instance
 */
export function createTerminalRenderer(): TerminalRenderer {
  return new TerminalRenderer();
}
