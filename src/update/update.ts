import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version: currentVersion } = require('../../package.json');

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
const AUTO_UPDATE_PROMPT_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const NPM_REGISTRY_API = 'https://registry.npmjs.org/@diggerhq/anyware';
const NPM_PACKAGE_NAME = '@diggerhq/anyware';

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  lastChecked: Date;
}

interface NpmPackageInfo {
  'dist-tags': {
    latest: string;
  };
}

/**
 * Check npm registry for the latest version
 */
export async function checkForUpdate(): Promise<VersionInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(NPM_REGISTRY_API, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`npm registry returned status ${response.status}`);
    }

    const pkgInfo = (await response.json()) as NpmPackageInfo;
    const latestVersion = pkgInfo['dist-tags'].latest;

    return {
      currentVersion,
      latestVersion,
      lastChecked: new Date(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare two semantic versions
 * Returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Check if an update is available
 */
export function isUpdateAvailable(info: VersionInfo): boolean {
  return (
    info.latestVersion !== '' &&
    info.currentVersion !== info.latestVersion &&
    compareVersions(info.currentVersion, info.latestVersion) < 0
  );
}

/**
 * Perform the update via npm
 */
export async function performUpdate(): Promise<void> {
  console.log('Checking for anyware installation method...');

  // Check if npm is available
  const npmAvailable = await new Promise<boolean>((resolve) => {
    const proc = spawn('npm', ['--version'], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });

  if (!npmAvailable) {
    throw new Error(
      `npm not found. Please install anyware using npm: npm install -g ${NPM_PACKAGE_NAME}`
    );
  }

  console.log(`Updating ${NPM_PACKAGE_NAME}...`);

  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', NPM_PACKAGE_NAME], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Update completed successfully!');
        console.log("\nRestart your terminal or run 'anyware -V' to verify the new version.");
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run npm: ${err.message}`));
    });
  });
}

/**
 * Prompt user for auto-update preference
 */
async function promptAutoUpdate(): Promise<boolean> {
  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(
      'Would you like to automatically update anyware when new versions are available? (Y/n): ',
      (answer) => {
        rl.close();
        const response = answer.trim().toLowerCase();
        resolve(response === 'y' || response === 'yes' || response === '');
      }
    );
  });
}

export interface VersionCache {
  lastUpdateCheck?: string;
  autoUpdateEnabled?: boolean;
  autoUpdatePromptExpiry?: string;
}

import { loadVersionCache, saveVersionCache } from '../config/config.js';

/**
 * Check if enough time has passed since last update check
 */
export function shouldCheckForUpdate(): boolean {
  const cache = loadVersionCache();

  if (!cache.lastUpdateCheck) {
    return true;
  }

  const lastCheck = new Date(cache.lastUpdateCheck);
  return Date.now() - lastCheck.getTime() > UPDATE_CHECK_INTERVAL;
}

/**
 * Save the last check time
 */
export function saveLastCheckTime(): void {
  const cache = loadVersionCache();
  cache.lastUpdateCheck = new Date().toISOString();
  saveVersionCache(cache);
}

/**
 * Check if auto-update is enabled
 */
function shouldAutoUpdate(cache: VersionCache): { autoUpdate: boolean; shouldPrompt: boolean } {
  // If preference hasn't been set or has expired, need to prompt
  if (
    cache.autoUpdateEnabled === undefined ||
    !cache.autoUpdatePromptExpiry ||
    new Date() > new Date(cache.autoUpdatePromptExpiry)
  ) {
    return { autoUpdate: false, shouldPrompt: true };
  }

  return { autoUpdate: cache.autoUpdateEnabled, shouldPrompt: false };
}

/**
 * Save auto-update preference
 */
function saveAutoUpdatePreference(enabled: boolean): void {
  const cache = loadVersionCache();
  cache.autoUpdateEnabled = enabled;
  cache.autoUpdatePromptExpiry = new Date(Date.now() + AUTO_UPDATE_PROMPT_DURATION).toISOString();
  saveVersionCache(cache);
}

/**
 * Check for updates and handle auto-update if enabled
 * Called automatically when running the CLI
 */
export async function checkAndNotify(): Promise<void> {
  if (!shouldCheckForUpdate()) {
    return;
  }

  let info: VersionInfo;
  try {
    info = await checkForUpdate();
  } catch {
    // Silently fail update checks to not disrupt user experience
    return;
  }

  // Save the check time regardless of result
  saveLastCheckTime();

  if (!isUpdateAvailable(info)) {
    return;
  }

  // Load version cache to check auto-update preference
  const cache = loadVersionCache();
  const { autoUpdate: shouldDoAutoUpdate, shouldPrompt } = shouldAutoUpdate(cache);

  let autoUpdate = shouldDoAutoUpdate;

  // If we need to prompt the user
  if (shouldPrompt) {
    console.error('\n');
    console.error('  New version of anyware is available!');
    console.error(`  Current: v${info.currentVersion} -> Latest: v${info.latestVersion}\n`);

    try {
      const enabled = await promptAutoUpdate();
      saveAutoUpdatePreference(enabled);
      autoUpdate = enabled;
    } catch {
      // If prompt fails, just return
      return;
    }
  }

  // Perform auto-update if enabled
  if (autoUpdate) {
    console.error(`\n🔄 Auto-updating anyware to v${info.latestVersion}...`);
    try {
      await performUpdate();
    } catch (err) {
      console.error(`\n❌ Auto-update failed: ${err instanceof Error ? err.message : err}`);
      console.error('You can manually update by running: anyware update\n');
    }
  }
}

export { currentVersion };
