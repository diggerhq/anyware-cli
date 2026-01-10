#!/usr/bin/env node
/**
 * Hook Forwarder
 *
 * This script is executed by Claude's hooks (SessionStart, PermissionRequest, etc.)
 * It reads JSON data from stdin and forwards it to the CLI's hook server.
 *
 * Usage: echo '{"session_id":"...","hook_event_name":"SessionStart"}' | node session_hook_forwarder.cjs <port>
 */

const http = require('http');

const port = parseInt(process.argv[2], 10);

if (!port || isNaN(port)) {
  process.exit(1);
}

const chunks = [];

process.stdin.on('data', (chunk) => {
  chunks.push(chunk);
});

process.stdin.on('end', () => {
  const body = Buffer.concat(chunks);

  const req = http.request(
    {
      host: '127.0.0.1',
      port: port,
      method: 'POST',
      path: '/hook',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    },
    (res) => {
      res.resume(); // Drain response
    }
  );

  req.on('error', () => {
    // Silently ignore errors - don't break Claude
  });

  req.end(body);
});

process.stdin.resume();
