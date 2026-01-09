import WebSocket from 'ws';
import { loadConfig } from '../config/config.js';

export interface WSMessage {
  type: string;
  payload?: unknown;
}

export interface ClaudeEvent {
  type: string;
  [key: string]: unknown;
}

// Image attachment from web UI
export interface ImageAttachment {
  name: string;
  mimeType: string;
  data: string; // base64 encoded image data
}

export interface UserInputMessage {
  type: 'user_input';
  payload: {
    sessionId: string;
    prompt: string;
    images?: ImageAttachment[];
  };
}

export interface PermissionResponseMessage {
  type: 'permission_response';
  payload: {
    sessionId: string;
    response: 'yes' | 'no' | 'always';
  };
}

export interface SwitchMessage {
  type: 'switch';
  payload: {
    sessionId: string;
  };
}

export type IncomingMessage = UserInputMessage | PermissionResponseMessage | SwitchMessage;

export interface SessionWSClient {
  send: (message: WSMessage) => void;
  sendClaudeEvent: (event: ClaudeEvent, sessionId: string) => void;
  sendThinking: (thinking: boolean) => void;
  sendModeChange: (mode: 'local' | 'remote') => void;
  sendPresence: (state: 'active' | 'idle' | 'away') => void;
  markActivity: () => void;
  onMessage: (handler: (message: IncomingMessage) => void) => void;
  onClose: (handler: () => void) => void;
  close: () => void;
}

export function createWSClient(sessionId: string, userId: string, deviceId?: string): Promise<SessionWSClient> {
  return new Promise((resolve, reject) => {
    const config = loadConfig();

    if (!config.accessToken) {
      reject(new Error('Not logged in'));
      return;
    }

    // Convert https to wss
    const wsUrl = config.apiUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    // Include deviceId in URL for device-level presence tracking
    const deviceParam = deviceId ? `&deviceId=${deviceId}` : '';
    const url = `${wsUrl}/ws/session/${sessionId}?type=cli&userId=${userId}${deviceParam}&token=${config.accessToken}`;

    let ws: WebSocket;
    let messageHandler: ((message: IncomingMessage) => void) | null = null;
    let closeHandler: (() => void) | null = null;
    let pingInterval: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnects = 50; // Allow many reconnects for long sessions
    let isIntentionallyClosed = false;
    let clientResolved = false;

    function connect() {
      ws = new WebSocket(url);

    ws.on('open', () => {
        if (reconnectAttempts > 0) {
          console.log('[ws] Reconnected to session');
        } else {
      console.log('[ws] Connected to session');
        }
        reconnectAttempts = 0;

      // Start ping interval to keep connection alive
        if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

        // Only resolve on first connection
        if (!clientResolved) {
          clientResolved = true;
          resolve(client);
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as WSMessage;

          // Handle pong silently
          if (message.type === 'pong') {
            return;
          }

          // Forward to handler
          if (messageHandler && (message.type === 'user_input' || message.type === 'permission_response' || message.type === 'switch')) {
            messageHandler(message as IncomingMessage);
          }
        } catch (e) {
          console.error('[ws] Failed to parse message:', e);
        }
      });

      ws.on('close', () => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }

        if (isIntentionallyClosed) {
          console.log('[ws] Disconnected from session');
          if (closeHandler) {
            closeHandler();
          }
          return;
        }

        // Auto-reconnect
        if (reconnectAttempts < maxReconnects) {
          reconnectAttempts++;
          const delay = Math.min(1000 * reconnectAttempts, 10000); // Cap at 10 seconds
          console.log(`[ws] Connection lost, reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${maxReconnects})`);
          setTimeout(connect, delay);
        } else {
          console.log('[ws] Max reconnect attempts reached, giving up');
          if (closeHandler) {
            closeHandler();
          }
        }
      });

      ws.on('error', (error) => {
        console.error('[ws] WebSocket error:', error.message);
        if (!clientResolved) {
          reject(error);
        }
        // Don't reject on reconnect errors - let the close handler trigger reconnect
      });
    }

      const client: SessionWSClient = {
        send: (message: WSMessage) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
          }
        },

        sendClaudeEvent: (event: ClaudeEvent, sid: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            // Use event's original timestamp if available, otherwise current time
            const eventWithTs = event as { timestamp?: string };
            let timestamp = Date.now();
            if (eventWithTs.timestamp) {
              const parsed = new Date(eventWithTs.timestamp).getTime();
              if (!isNaN(parsed)) {
                timestamp = parsed;
              }
            }
            
            ws.send(JSON.stringify({
              type: 'claude_event',
              payload: {
                sessionId: sid,
                event,
                timestamp,
              },
            }));
          }
        },

        sendThinking: (thinking: boolean) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'thinking',
              payload: {
                thinking,
                timestamp: Date.now(),
              },
            }));
          }
        },

        sendModeChange: (mode: 'local' | 'remote') => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'mode_change',
              payload: {
                mode,
                timestamp: Date.now(),
              },
            }));
          }
        },

        // No-op: Device presence is now tracked via WebSocket connect/disconnect
        // and activity updates happen automatically on claude_event
        sendPresence: () => {},
        markActivity: () => {},

        onMessage: (handler) => {
          messageHandler = handler;
        },

        onClose: (handler) => {
          closeHandler = handler;
        },

        close: () => {
        isIntentionallyClosed = true;
          if (pingInterval) {
            clearInterval(pingInterval);
          }
          ws.close();
        },
      };

    // Start initial connection
    connect();
  });
}
