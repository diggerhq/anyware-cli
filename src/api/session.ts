import { loadConfig } from '../config/config.js';
import type { HistoricalEvent } from '../utils/claudeHistory.js';

interface CreateSessionResponse {
  sessionId: string;
}

interface Session {
  id: string;
  userId: string;
  deviceId?: string;
  status: 'active' | 'ended';
  cwd?: string;
  startedAt: string;
  endedAt?: string;
}

interface CreateSessionOptions {
  cwd: string;
  continueFromHistory?: boolean;
  history?: HistoricalEvent[];
}

export async function createSession(cwdOrOptions: string | CreateSessionOptions): Promise<string> {
  const config = loadConfig();

  if (!config.accessToken) {
    throw new Error('Not logged in. Please run "anyware login" first.');
  }

  // Support both old signature (just cwd string) and new options object
  const options: CreateSessionOptions = typeof cwdOrOptions === 'string' 
    ? { cwd: cwdOrOptions }
    : cwdOrOptions;

  const body: Record<string, unknown> = { cwd: options.cwd };
  
  if (options.continueFromHistory && options.history && options.history.length > 0) {
    body.history = options.history;
    console.log(`[session] Sending ${options.history.length} historical events`);
  }

  const response = await fetch(`${config.apiUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    const data = await response.json() as { error: string; message: string; upgradeUrl: string };
    throw new Error(`${data.message}\nUpgrade at: ${data.upgradeUrl}`);
  }

  if (!response.ok) {
    const data = await response.json() as { error: string };
    throw new Error(data.error || 'Failed to create session');
  }

  const result = await response.json() as CreateSessionResponse;
  return result.sessionId;
}

export async function endSession(sessionId: string): Promise<void> {
  const config = loadConfig();

  if (!config.accessToken) {
    throw new Error('Not logged in');
  }

  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
    },
  });

  if (!response.ok) {
    console.error('Failed to end session:', response.statusText);
  }
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const config = loadConfig();

  if (!config.accessToken) {
    throw new Error('Not logged in');
  }

  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Failed to get session');
  }

  const result = await response.json() as { session: Session };
  return result.session;
}
