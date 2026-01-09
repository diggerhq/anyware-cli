#!/usr/bin/env node

/**
 * Anyware CLI - Claude Code with remote control
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { login } from './api/auth.js';
import { createSession, endSession } from './api/session.js';
import { loadConfig, saveConfig, clearConfig, isLoggedIn } from './config/config.js';
import { Session } from './claude/session.js';
import { loop } from './claude/loop.js';
import { StatusBar } from './ui/statusBar.js';
import {
  checkForUpdate,
  isUpdateAvailable,
  performUpdate,
  checkAndNotify,
  currentVersion,
} from './update/update.js';
import {
  validateClaudeArgs,
  formatValidationErrors,
  getClaudeArgsHelp,
} from './claude/claudeArgs.js';
import { setupAlias, promptEnjoymentAndAlias } from './utils/aliasSetup.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('anyware')
  .description('Claude Code with remote control')
  .version(version);

// Login command
program
  .command('login')
  .description('Login to Anyware')
  .action(async () => {
    try {
      await login();
    } catch (error) {
      console.error('Login failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Logout command
program
  .command('logout')
  .description('Logout from Anyware')
  .action(() => {
    clearConfig();
    console.log('Logged out successfully');
  });

// Alias command
program
  .command('alias')
  .description('Set up "claude" as an alias for "anyware"')
  .action(() => {
    setupAlias();
  });

// Status command
program
  .command('status')
  .description('Show login status')
  .action(() => {
    const config = loadConfig();
    if (isLoggedIn()) {
      console.log(`Logged in as: ${config.email || config.userId}`);
      console.log(`API URL: ${config.apiUrl}`);
    } else {
      console.log('Not logged in. Run "anyware login" to authenticate.');
    }
  });

// Version command (with update check)
program
  .command('version')
  .description('Print version information')
  .action(async () => {
    console.log(`anyware v${version}`);

    try {
      const info = await checkForUpdate();
      if (isUpdateAvailable(info)) {
        console.log(`\n💡 A new version is available: v${info.latestVersion}`);
        console.log("Run 'anyware update' to upgrade");
      }
    } catch {
      // Silently ignore update check errors
    }
  });

// Update command
program
  .command('update')
  .description('Update anyware to the latest version')
  .action(async () => {
    console.log(`Current version: v${version}`);

    try {
      const info = await checkForUpdate();

      if (!isUpdateAvailable(info)) {
        console.log('✅ You are already running the latest version!');
        return;
      }

      console.log(`Latest version: v${info.latestVersion}\n`);
      await performUpdate();
    } catch (error) {
      console.error('Failed to update:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Set configuration')
  .option('--api-url <url>', 'Set API URL')
  .option('--llm-url <url>', 'Set LLM URL')
  .action((options) => {
    const updates: Record<string, string> = {};

    if (options.apiUrl) {
      updates.apiUrl = options.apiUrl;
      console.log(`API URL set to: ${options.apiUrl}`);
    }

    if (options.llmUrl) {
      updates.llmUrl = options.llmUrl;
      console.log(`LLM URL set to: ${options.llmUrl}`);
    }

    if (Object.keys(updates).length > 0) {
      saveConfig(updates);
    } else {
      const config = loadConfig();
      console.log('Current configuration:');
      console.log(`  API URL: ${config.apiUrl}`);
      console.log(`  LLM URL: ${config.llmUrl}`);
    }
  });

// Claude args help command
program
  .command('claude-args')
  .description('Show valid Claude Code arguments that can be passed through')
  .action(() => {
    console.log(getClaudeArgsHelp());
  });

// Main run command (default)
program
  .command('run', { isDefault: true })
  .description('Start Claude Code with remote control.\n  Pass additional Claude Code args after options (e.g., anyware run --verbose)')
  .argument('[claude-args...]', 'Additional Claude Code arguments (run "anyware claude-args" for list)')
  .option('-p, --path <path>', 'Working directory', process.cwd())
  .option('--resume <sessionId>', 'Resume a Claude session')
  .option('--continue', 'Continue the last conversation')
  .option('--remote', 'Start in remote mode')
  .option('-m, --model <model>', 'Model to use via OpenRouter (e.g., anthropic/claude-sonnet-4, openai/gpt-4o)')
  .allowUnknownOption()
  .action(async (claudeArgsFromCommand: string[], options) => {
    // Check login
    if (!isLoggedIn()) {
      console.log('Not logged in. Please run "anyware login" first.');
      process.exit(1);
    }

    // Passthrough args come from variadic argument and any unknown options
    const passthroughArgs = claudeArgsFromCommand;

    // Validate passthrough args if any
    if (passthroughArgs.length > 0) {
      const validation = validateClaudeArgs(passthroughArgs);
      
      // Show warnings
      if (validation.warnings.length > 0) {
        console.log('\x1b[33m' + formatValidationErrors({ ...validation, errors: [] }) + '\x1b[0m\n');
      }
      
      // Exit on errors
      if (!validation.valid) {
        console.error('\x1b[31m' + formatValidationErrors(validation) + '\x1b[0m');
        console.log('\nRun "anyware claude-args" to see valid Claude Code arguments.');
        process.exit(1);
      }
    }

    // Check for updates before starting Claude
    // This must happen before Claude takes over stdin/stdout
    await checkAndNotify();

    // Increment session count and check for enjoyment prompt
    const preConfig = loadConfig();
    const newSessionCount = (preConfig.sessionCount || 0) + 1;
    saveConfig({ sessionCount: newSessionCount });

    // After 10 sessions, prompt user about setting up the claude alias (only once)
    // This shows even if they said "no" on the first login prompt, giving them another chance
    if (newSessionCount === 10 && !preConfig.enjoymentPromptShown) {
      const prompted = await promptEnjoymentAndAlias();
      if (prompted) {
        saveConfig({ enjoymentPromptShown: true });
      }
    }

    const config = loadConfig();

    // Determine model: flag takes precedence over ANYWARE_MODEL env var
    const model = options.model || process.env.ANYWARE_MODEL;

    // Set up LLM proxy environment variables
    // Model is passed via --model flag to Claude Code, proxy just forwards the request
    // ANTHROPIC_AUTH_TOKEN bypasses Claude Code's login flow entirely
    process.env.ANTHROPIC_BASE_URL = config.llmUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = config.accessToken;
    delete process.env.ANTHROPIC_API_KEY;  // Clear to avoid conflicts

    if (model) {
      console.log(`Using model: ${model}`);
    }

    try {
      // Note: We no longer pre-import historical events here.
      // The session scanner (TUI mode) or SDK (remote mode) will capture events
      // with their original timestamps, avoiding duplicate imports.

      // Create server session
      const serverSessionId = await createSession(options.path);

      // Create and start status bar
      const statusBar = new StatusBar({ sessionId: serverSessionId });

      // Build Claude args
      const claudeArgs: string[] = [];
      if (model) {
        // Pass model directly to Claude Code
        claudeArgs.push('--model', model);
      }
      if (options.resume) {
        claudeArgs.push('--resume', options.resume);
      }
      if (options.continue) {
        claudeArgs.push('--continue');
      }
      
      // Add validated passthrough args
      if (passthroughArgs.length > 0) {
        const validation = validateClaudeArgs(passthroughArgs);
        claudeArgs.push(...validation.validArgs);
      }

      // Create session instance
      const session = new Session({
        serverSessionId,
        userId: config.userId!,
        deviceId: config.deviceId,
        path: options.path,
        claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
      });

      // Connect to WebSocket
      console.log('Connecting to server...');
      await session.connect();

      // Start status bar after connection
      statusBar.start();

      // Handle cleanup
      const cleanup = async () => {
        statusBar.stop();
        console.log('\nShutting down...');
        session.close();
        await endSession(serverSessionId);
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Run the mode loop
      await loop({
        session,
        startingMode: options.remote ? 'remote' : 'local',
        onModeChange: (mode) => statusBar.setMode(mode),
        onIdle: () => {
          // Redraw status bar when Claude finishes responding
          statusBar.redraw();
        },
      });

      // Cleanup on normal exit
      statusBar.stop();
      session.close();
      await endSession(serverSessionId);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
