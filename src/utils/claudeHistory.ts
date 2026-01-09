/**
 * Read Claude Code's local session history for a given project path.
 * 
 * Claude stores sessions in ~/.claude/projects/{encoded-path}/*.jsonl
 * where {encoded-path} is the full path with / replaced by -
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Claude's local event types that we want to import
interface ClaudeLocalEvent {
  type: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  cwd?: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>;
  };
  toolUseResult?: unknown;
}

// Simplified event format to send to API
export interface HistoricalEvent {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  timestamp: number;
  content?: string;
  message?: {
    role: string;
    content: unknown;
  };
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
}

/**
 * Encode a path the same way Claude does for project folders
 * /Users/brian/myproject -> -Users-brian-myproject
 */
function encodeProjectPath(path: string): string {
  return path.replace(/\//g, '-');
}

/**
 * Get the Claude projects directory
 */
function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Find the most recent MAIN session file for a project (not sub-agent sessions)
 * Main session files have UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.jsonl
 * Sub-agent files have format: agent-xxxxxxx.jsonl
 */
function findLatestSessionFile(projectDir: string): string | null {
  if (!existsSync(projectDir)) {
    return null;
  }

  // UUID pattern for main session files
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

  const files = readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    // Only include main session files (UUID format), not sub-agent files
    .filter(f => uuidPattern.test(f))
    .map(f => ({
      name: f,
      path: join(projectDir, f),
      mtime: statSync(join(projectDir, f)).mtime.getTime(),
      size: statSync(join(projectDir, f)).size,
    }))
    // Filter out empty files
    .filter(f => f.size > 0)
    // Sort by modification time, newest first
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.log('[history] No main session files found (agent sessions excluded)');
    return null;
  }

  console.log(`[history] Found ${files.length} main session files, using: ${files[0].name} (${files[0].size} bytes)`);
  return files[0].path;
}

/**
 * Parse a JSONL file into events
 */
function parseSessionFile(filePath: string): ClaudeLocalEvent[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const events: ClaudeLocalEvent[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      events.push(parsed);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Convert Claude's local events to our API format
 */
function convertToHistoricalEvents(events: ClaudeLocalEvent[]): HistoricalEvent[] {
  const result: HistoricalEvent[] = [];
  let userCount = 0;
  let assistantCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    // Skip internal events
    if (event.type === 'queue-operation' || event.type === 'change' || event.type === 'file-history-snapshot') {
      skippedCount++;
      continue;
    }

    const timestamp = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();

    if (event.type === 'user' && event.message) {
      userCount++;
      // Extract content for logging
      const content = event.message.content;
      const preview = typeof content === 'string' 
        ? content.slice(0, 50) 
        : Array.isArray(content) 
          ? (content[0]?.text?.slice(0, 50) || '[complex content]')
          : '[unknown format]';
      console.log(`[history] User message: "${preview}..."`);
      
      result.push({
        type: 'user',
        timestamp,
        message: event.message,
      });
    } else if (event.type === 'assistant' && event.message) {
      assistantCount++;
      result.push({
        type: 'assistant',
        timestamp,
        message: event.message,
      });
    }
  }

  console.log(`[history] Conversion stats: ${userCount} user, ${assistantCount} assistant, ${skippedCount} skipped`);
  return result;
}

/**
 * Read Claude's local session history for a project path
 * Returns the most recent N events from the latest session, or null if none found
 * @param projectPath - The project directory path
 * @param limit - Maximum number of messages to return (default 100)
 */
export function readClaudeLocalHistory(projectPath: string, limit: number = 250): HistoricalEvent[] | null {
  const projectsDir = getClaudeProjectsDir();
  const encodedPath = encodeProjectPath(projectPath);
  const projectDir = join(projectsDir, encodedPath);

  console.log(`[history] Looking for Claude history in: ${projectDir}`);

  const latestSession = findLatestSessionFile(projectDir);
  if (!latestSession) {
    console.log('[history] No Claude session history found');
    return null;
  }

  console.log(`[history] Found session file: ${latestSession}`);

  const events = parseSessionFile(latestSession);
  console.log(`[history] Parsed ${events.length} raw events`);

  const historicalEvents = convertToHistoricalEvents(events);
  console.log(`[history] Converted to ${historicalEvents.length} historical events`);

  // Return only the most recent N messages
  if (historicalEvents.length > limit) {
    console.log(`[history] Limiting to most recent ${limit} messages (had ${historicalEvents.length})`);
    return historicalEvents.slice(-limit);
  }

  return historicalEvents;
}

/**
 * Get info about previous sessions in a project folder
 */
export function getSessionsInfo(projectPath: string): { count: number; latestTimestamp: number | null } {
  const projectsDir = getClaudeProjectsDir();
  const encodedPath = encodeProjectPath(projectPath);
  const projectDir = join(projectsDir, encodedPath);

  if (!existsSync(projectDir)) {
    return { count: 0, latestTimestamp: null };
  }

  const files = readdirSync(projectDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      path: join(projectDir, f),
      mtime: statSync(join(projectDir, f)).mtime.getTime(),
      size: statSync(join(projectDir, f)).size,
    }))
    .filter(f => f.size > 0);

  if (files.length === 0) {
    return { count: 0, latestTimestamp: null };
  }

  const latestTimestamp = Math.max(...files.map(f => f.mtime));
  return { count: files.length, latestTimestamp };
}
