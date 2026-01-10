/**
 * StatusBar - A status bar that shows at the bottom of the terminal
 *
 * Instead of constantly redrawing (which pollutes scrollback), this version:
 * - Draws once when started
 * - Redraws on explicit triggers (mode change, resize)
 * - Gets overwritten by terminal output (expected behavior)
 * - Reappears when Claude is idle
 */

export interface StatusBarOptions {
  sessionId: string;
  sessionUrl?: string;
}

export class StatusBar {
  private sessionId: string;
  private sessionUrl: string;
  private mode: 'local' | 'remote' = 'local';
  private connected: boolean = true;
  private started: boolean = false;
  private resizeHandler: (() => void) | null = null;

  constructor(opts: StatusBarOptions) {
    this.sessionId = opts.sessionId;
    this.sessionUrl = opts.sessionUrl ?? `https://anyware.run/session/${opts.sessionId}`;
  }

  /**
   * Start the status bar
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Set up resize handler
    this.resizeHandler = () => this.draw();
    process.stdout.on('resize', this.resizeHandler);

    // Initial draw
    this.draw();
  }

  /**
   * Draw the status bar at the bottom of the terminal
   */
  private draw(): void {
    if (!this.started) return;
    if (!process.stdout.isTTY) return;

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Build status bar content
    const content = this.buildContent(cols);

    // Save cursor, move to last line, draw, restore cursor
    const output =
      '\x1b7' +                          // Save cursor (DEC)
      `\x1b[${rows};1H` +                // Move to last row, column 1
      '\x1b[7m' +                         // Inverse video
      content +
      '\x1b[0m' +                         // Reset all attributes
      '\x1b8';                            // Restore cursor (DEC)

    process.stdout.write(output);
  }

  /**
   * Build the status bar content string
   */
  private buildContent(width: number): string {
    // Simple format: "view session at <link>"
    const fullUrl = `https://anyware.run/session/${this.sessionId}`;
    const contentStr = ` view session at ${fullUrl}`;
    return contentStr.padEnd(width, ' ');
  }

  /**
   * Update the current mode
   */
  setMode(mode: 'local' | 'remote'): void {
    this.mode = mode;
    this.draw();
  }

  /**
   * Update connection status
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
    this.draw();
  }

  /**
   * Force an immediate redraw - call this when you know the terminal is stable
   */
  redraw(): void {
    this.draw();
  }

  /**
   * Stop the status bar and clean up
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    // Remove resize handler
    if (this.resizeHandler) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Clear the status bar line
    if (process.stdout.isTTY) {
      const rows = process.stdout.rows || 24;
      process.stdout.write(
        '\x1b7' +                        // Save cursor
        `\x1b[${rows};1H` +              // Move to last row
        '\x1b[2K' +                       // Clear entire line
        '\x1b8'                           // Restore cursor
      );
    }
  }
}
