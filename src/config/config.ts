import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  accessToken?: string;
  userId?: string;
  deviceId?: string;
  email?: string;
  apiUrl: string;
  llmUrl: string;
  aliasPromptShown?: boolean;
  sessionCount?: number;
  enjoymentPromptShown?: boolean;
}

export interface VersionCache {
  lastUpdateCheck?: string;
  autoUpdateEnabled?: boolean;
  autoUpdatePromptExpiry?: string;
}

const CONFIG_DIR = join(homedir(), '.anyware');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const VERSION_CACHE_FILE = join(CONFIG_DIR, 'version-cache.json');

const ENV_API_URL = 'ANYWARE_API_URL';
const ENV_LLM_URL = 'ANYWARE_LLM_URL';

const DEFAULT_API_URL = 'https://anyware.run';
const DEFAULT_LLM_URL = 'https://llm.anyware.run';

const DEFAULT_CONFIG: Config = {
  apiUrl: DEFAULT_API_URL,
  llmUrl: DEFAULT_LLM_URL,
};

// Get API URL with priority: env var > config file > default
function getApiUrl(configValue?: string): string {
  return process.env[ENV_API_URL] || configValue || DEFAULT_API_URL;
}

// Get LLM URL with priority: env var > config file > default
function getLlmUrl(configValue?: string): string {
  return process.env[ENV_LLM_URL] || configValue || DEFAULT_LLM_URL;
}

export function loadConfig(): Config {
  let fileConfig: Partial<Config> = {};

  if (existsSync(CONFIG_FILE)) {
    try {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(data);
    } catch {
      // ignore parse errors
    }
  }

  return {
    ...fileConfig,
    apiUrl: getApiUrl(fileConfig.apiUrl),
    llmUrl: getLlmUrl(fileConfig.llmUrl),
  };
}

export function saveConfig(config: Partial<Config>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const existing = loadConfig();
  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    // Preserve device-specific settings when logging out
    const existing = loadConfig();
    const preservedConfig = {
      ...DEFAULT_CONFIG,
      aliasPromptShown: existing.aliasPromptShown,
      enjoymentPromptShown: existing.enjoymentPromptShown,
      sessionCount: existing.sessionCount,
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(preservedConfig, null, 2));
  }
}

export function isLoggedIn(): boolean {
  const config = loadConfig();
  return !!config.accessToken && !!config.userId;
}

export function loadVersionCache(): VersionCache {
  if (!existsSync(VERSION_CACHE_FILE)) {
    return {};
  }

  try {
    const data = readFileSync(VERSION_CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function saveVersionCache(cache: VersionCache): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(VERSION_CACHE_FILE, JSON.stringify(cache, null, 2));
}
