import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as readline from 'node:readline';
import { loadConfig } from '../config/config.js';

const ALIAS_LINE = 'alias claude="anyware"';
const ALIAS_COMMENT = '# Added by Anyware - use claude command with Anyware';

interface ShellConfig {
  name: string;
  configFile: string;
}

function getShellConfigs(): ShellConfig[] {
  const home = homedir();
  const shell = process.env.SHELL || '';

  const configs: ShellConfig[] = [];

  // Check for zsh
  const zshrc = join(home, '.zshrc');
  if (shell.includes('zsh') || existsSync(zshrc)) {
    configs.push({ name: 'zsh', configFile: zshrc });
  }

  // Check for bash
  const bashrc = join(home, '.bashrc');
  const bashProfile = join(home, '.bash_profile');
  if (shell.includes('bash')) {
    // On macOS, .bash_profile is typically used for login shells
    if (process.platform === 'darwin' && existsSync(bashProfile)) {
      configs.push({ name: 'bash', configFile: bashProfile });
    } else if (existsSync(bashrc)) {
      configs.push({ name: 'bash', configFile: bashrc });
    }
  }

  // Check for fish
  const fishConfig = join(home, '.config', 'fish', 'config.fish');
  if (shell.includes('fish') || existsSync(fishConfig)) {
    configs.push({ name: 'fish', configFile: fishConfig });
  }

  return configs;
}

function hasAliasAlready(configFile: string): boolean {
  if (!existsSync(configFile)) {
    return false;
  }
  const content = readFileSync(configFile, 'utf-8');
  return content.includes('alias claude=') || content.includes('alias claude =');
}

function addAliasToFile(configFile: string, isFish: boolean): boolean {
  try {
    const aliasLine = isFish
      ? 'alias claude "anyware"'
      : ALIAS_LINE;
    const content = `\n${ALIAS_COMMENT}\n${aliasLine}\n`;
    appendFileSync(configFile, content);
    return true;
  } catch {
    return false;
  }
}

function hasReachedAliasPromptThreshold(): boolean {
  const config = loadConfig();
  return (config.sessionCount || 0) >= 10;
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

export async function promptAliasSetup(): Promise<void> {
  if (!hasReachedAliasPromptThreshold()) {
    return;
  }

  const shellConfigs = getShellConfigs();

  if (shellConfigs.length === 0) {
    console.log('\nCould not detect your shell configuration file.');
    console.log('To use "claude" as an alias for "anyware", add this to your shell config:');
    console.log(`  ${ALIAS_LINE}`);
    return;
  }

  console.log('\n---');
  console.log('Would you like to use `claude` instead of `anyware`?');
  console.log('This will add an alias to your shell configuration.\n');

  const shouldSetup = await promptYesNo('Set up alias? [y/N]: ');

  if (!shouldSetup) {
    console.log('\nNo problem! You can always run `anyware` directly.');
    console.log('To set up the alias later, run `anyware alias` or add this to your shell config:');
    console.log(`  ${ALIAS_LINE}`);
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const config of shellConfigs) {
    if (hasAliasAlready(config.configFile)) {
      console.log(`  Skipped ${config.configFile} (alias already exists)`);
      skippedCount++;
      continue;
    }

    const isFish = config.name === 'fish';
    if (addAliasToFile(config.configFile, isFish)) {
      console.log(`  Added alias to ${config.configFile}`);
      addedCount++;
    } else {
      console.log(`  Failed to add alias to ${config.configFile}`);
    }
  }

  if (addedCount > 0) {
    console.log('\nAlias added successfully!');
    console.log('Run `source ~/.zshrc` (or restart your terminal) to use the `claude` command.');
  } else if (skippedCount > 0) {
    console.log('\nAlias already configured in your shell.');
  }
}

/**
 * Directly set up the claude alias without prompting.
 * Used by the `anyware alias` command.
 */
export function setupAlias(): void {
  const shellConfigs = getShellConfigs();

  if (shellConfigs.length === 0) {
    console.log('Could not detect your shell configuration file.');
    console.log('To use "claude" as an alias for "anyware", add this to your shell config:');
    console.log(`  ${ALIAS_LINE}`);
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const config of shellConfigs) {
    if (hasAliasAlready(config.configFile)) {
      console.log(`Skipped ${config.configFile} (alias already exists)`);
      skippedCount++;
      continue;
    }

    const isFish = config.name === 'fish';
    if (addAliasToFile(config.configFile, isFish)) {
      console.log(`Added alias to ${config.configFile}`);
      addedCount++;
    } else {
      console.log(`Failed to add alias to ${config.configFile}`);
    }
  }

  if (addedCount > 0) {
    console.log('\nAlias added successfully!');
    console.log('Run `source ~/.zshrc` (or restart your terminal) to use the `claude` command.');
  } else if (skippedCount > 0 && addedCount === 0) {
    console.log('\nAlias already configured in your shell. No changes made.');
  }
}

/**
 * Check if the claude alias is already configured in any shell config.
 */
export function isAliasConfigured(): boolean {
  const shellConfigs = getShellConfigs();
  return shellConfigs.some(config => hasAliasAlready(config.configFile));
}

/**
 * Prompt user if they're enjoying Anyware and want to set up the claude alias.
 * Returns true if the prompt was shown (regardless of user's answer).
 */
export async function promptEnjoymentAndAlias(): Promise<boolean> {
  if (!hasReachedAliasPromptThreshold()) {
    return false;
  }

  // Skip if alias is already configured
  if (isAliasConfigured()) {
    return false;
  }

  const shellConfigs = getShellConfigs();
  if (shellConfigs.length === 0) {
    return false;
  }

  console.log('\n---');
  console.log('Enjoying Anyware? Would you like to use `claude` to launch it?');
  console.log('This will add an alias to your shell configuration.\n');

  const shouldSetup = await promptYesNo('Set up alias? [y/N]: ');

  if (!shouldSetup) {
    console.log('\nNo problem! You can set this up later with `anyware alias`.\n');
    return true;
  }

  let addedCount = 0;

  for (const config of shellConfigs) {
    if (hasAliasAlready(config.configFile)) {
      continue;
    }

    const isFish = config.name === 'fish';
    if (addAliasToFile(config.configFile, isFish)) {
      console.log(`  Added alias to ${config.configFile}`);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    console.log('\nAlias added! Restart your terminal or run `source ~/.zshrc` to use `claude`.\n');
  }

  return true;
}
