# Anyware CLI

The command-line client for [Anyware](https://anyware.run) — control Claude Code from anywhere, on any device.

Anyware CLI runs Claude Code locally on your machine while streaming the session to the cloud. Continue working from your phone, laptop, or any browser. Get notified when Claude needs your input.

## Installation

```bash
npm install -g @diggerhq/anyware
```

Requires Node.js >= 20.0.0

## Quick Start

```bash
# Login (opens browser for authentication)
anyware login

# Start a session in your project directory
cd /path/to/your/project
anyware
```

That's it. Your session is now live at [anyware.run](https://anyware.run).

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Your Machine                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        anyware CLI                                │  │
│  │  ┌────────────┐    ┌─────────────┐    ┌─────────────────────┐   │  │
│  │  │ Loop       │◄──►│ Session     │◄──►│ WebSocket Client    │───┼──┼──► anyware.run
│  │  │ local/     │    │ manager     │    │ (real-time sync)    │   │  │
│  │  │ remote     │    └─────────────┘    └─────────────────────┘   │  │
│  │  └─────┬──────┘                                                  │  │
│  │        │                                                         │  │
│  │        ▼                                                         │  │
│  │  ┌────────────┐    ┌─────────────┐                              │  │
│  │  │ Claude     │───►│ LLM Proxy   │─────────────────────────────┼──┼──► OpenRouter
│  │  │ Code       │    │ (model      │                              │  │
│  │  │ (spawned)  │    │  routing)   │                              │  │
│  │  └────────────┘    └─────────────┘                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Dual-Mode Operation

The CLI operates in two modes that switch automatically:

- **Local mode**: You type directly in the terminal. Claude responds locally, and output streams to the web dashboard.
- **Remote mode**: Commands come from the web dashboard via WebSocket. Output appears both in your terminal and the web UI.

Mode switching happens seamlessly:
- **Local → Remote**: When you send a message from the web dashboard
- **Remote → Local**: When you press Enter in the terminal to take back control

## Commands

### `anyware`

Start a Claude Code session in the current directory.

```bash
anyware                          # Start session
anyware --model openai/gpt-4o    # Use a specific model via OpenRouter
anyware --continue               # Continue the last conversation
anyware --resume <sessionId>     # Resume a specific Claude session
anyware --remote                 # Start in remote mode
anyware --path /other/dir        # Use a different working directory
```

### `anyware login`

Authenticate with anyware.run. Opens your browser to complete the OAuth flow.

```bash
anyware login
```

### `anyware logout`

Clear local credentials.

```bash
anyware logout
```

### `anyware status`

Show current login status and configuration.

```bash
anyware status
```

### `anyware config`

View or set configuration options.

```bash
anyware config                   # Show current config
anyware config --api-url <url>   # Set custom API URL
anyware config --llm-url <url>   # Set custom LLM proxy URL
```

### `anyware update`

Update to the latest version.

```bash
anyware update
```

### `anyware version`

Print version information and check for updates.

```bash
anyware version
```

### `anyware alias`

Set up `claude` as an alias for `anyware` in your shell.

```bash
anyware alias
```

### `anyware claude-args`

Show valid Claude Code arguments that can be passed through.

```bash
anyware claude-args
```

## Custom Models

Use any model available on [OpenRouter](https://openrouter.ai):

```bash
anyware --model openai/gpt-4o
anyware --model google/gemini-2.0-flash-001
anyware --model anthropic/claude-sonnet-4
```

Or set a default model via environment variable:

```bash
export ANYWARE_MODEL=openai/gpt-4o
anyware
```

## Configuration

Configuration is stored in `~/.anyware/config.json`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANYWARE_API_URL` | Override the API URL (default: `https://anyware.run`) |
| `ANYWARE_LLM_URL` | Override the LLM proxy URL (default: `https://llm.anyware.run`) |
| `ANYWARE_MODEL` | Default model to use via OpenRouter |

## Web Dashboard

1. Go to [anyware.run](https://anyware.run)
2. Login with the same account
3. See active sessions, click to view live terminal
4. Type to send prompts, approve tool permissions

## Notifications

Get SMS or WhatsApp alerts when Claude needs input and you're away from your terminal. Configure at [anyware.run/settings/notifications](https://anyware.run/settings/notifications).

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/diggerhq/anyware-cli.git
cd anyware-cli

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run from source with tsx |
| `npm run start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting |

### Project Structure

```
src/
├── main.ts              # CLI entry point (commander setup)
├── api/                 # Server communication
│   ├── auth.ts          # OAuth login flow
│   ├── session.ts       # Session creation/management
│   └── wsClient.ts      # WebSocket client
├── claude/              # Claude Code integration
│   ├── loop.ts          # Local/remote mode switching
│   ├── session.ts       # Session state management
│   ├── claudeLocal*.ts  # Local mode (terminal UI)
│   ├── claudeRemote*.ts # Remote mode (SDK-based)
│   └── sdk/             # Claude SDK wrapper
├── config/              # Configuration management
├── hooks/               # Session hooks
├── ui/                  # Terminal UI components
├── update/              # Self-update functionality
└── utils/               # Utilities (message queue, etc.)
```

## Self-Hosting

See the main [Anyware repository](https://github.com/diggerhq/anyware) for self-hosting documentation.

## License

MIT

## Links

- [Anyware Website](https://anyware.run)
- [Documentation](https://docs.anyware.run)
- [Main Repository](https://github.com/diggerhq/anyware)
