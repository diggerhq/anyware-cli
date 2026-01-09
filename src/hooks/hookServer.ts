/**
 * HTTP server for receiving Claude hooks
 *
 * Claude's hooks (SessionStart, PermissionRequest, PostToolUse, etc.)
 * notify us of events during the session.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';

/**
 * Hook event types from Claude
 */
export type HookEventType =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'Stop'
  | 'SessionEnd';

/**
 * Data received from Claude hooks
 */
export interface HookData {
  session_id?: string;
  sessionId?: string;
  hook_event_name?: HookEventType;
  transcript_path?: string;
  cwd?: string;
  source?: string;
  // PermissionRequest / PostToolUse fields
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: string;
  // UserPromptSubmit fields
  prompt?: string;
  // Stop fields
  stop_reason?: string;
  response?: string;
  [key: string]: unknown;
}

export interface HookServerOptions {
  /** Called when a session hook is received with a valid session ID */
  onSessionHook: (sessionId: string, data: HookData) => void;
  /** Called when any hook event is received (for forwarding to WebSocket) */
  onHookEvent?: (eventType: HookEventType, sessionId: string, data: HookData) => void;
}

export interface HookServer {
  /** The port the server is listening on */
  port: number;
  /** Stop the server */
  stop: () => void;
}

/**
 * Start a dedicated HTTP server for receiving Claude hooks
 */
export async function startHookServer(options: HookServerOptions): Promise<HookServer> {
  const { onSessionHook, onHookEvent } = options;

  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Handle POST to /hook (all hook types) or /hook/session-start (legacy)
      if (req.method === 'POST' && (req.url === '/hook' || req.url === '/hook/session-start')) {
        // Set timeout to prevent hanging
        const timeout = setTimeout(() => {
          if (!res.headersSent) {
            res.writeHead(408).end('timeout');
          }
        }, 5000);

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          clearTimeout(timeout);

          const body = Buffer.concat(chunks).toString('utf-8');

          let data: HookData = {};
          try {
            data = JSON.parse(body);
          } catch {
            // Ignore parse errors
          }

          // Support both snake_case (from Claude) and camelCase
          const sessionId = data.session_id || data.sessionId;
          const eventType = data.hook_event_name as HookEventType;

          if (sessionId) {
            // For SessionStart, call the session hook handler
            if (eventType === 'SessionStart' || req.url === '/hook/session-start') {
              onSessionHook(sessionId, data);
            }

            // Forward all events via onHookEvent callback
            if (onHookEvent && eventType) {
              onHookEvent(eventType, sessionId, data);
            }
          }

          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        } catch (error) {
          clearTimeout(timeout);
          if (!res.headersSent) {
            res.writeHead(500).end('error');
          }
        }
        return;
      }

      // 404 for anything else
      res.writeHead(404).end('not found');
    });

    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const port = address.port;

      resolve({
        port,
        stop: () => {
          server.close();
        },
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
