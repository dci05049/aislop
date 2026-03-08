# aislop

Saves Claude Code session transcripts to MinIO (S3-compatible) at the end of every session via a Claude Code hook.

## How it works

1. Claude Code fires the `SessionEnd` hook, piping a JSON payload to stdin.
2. `on-session-end.ts` reads the payload, parses the `.jsonl` transcript, and POSTs the entries to the Fastify server.
3. The Fastify server writes the array to the `claude-history` MinIO bucket as `context-<timestamp>.json`.

## Project structure

```
docker-compose.yml   MinIO service (API :9000, Console :9001)
server.ts            Fastify server — POST /upload-context → MinIO
on-session-end.ts    Claude Code SessionEnd hook entry point
transcript.ts        Stdin reader and .jsonl parser
types.ts             Shared TypeScript types (transcript entries, session payload)
```

## Prerequisites

- Docker
- Node.js 18+
- npm

## Setup

```bash
npm install
docker compose up -d        # start MinIO
npm start                   # start Fastify server on :3000
```

## MinIO credentials

| Field    | Value       |
|----------|-------------|
| User     | admin       |
| Password | password123 |
| API      | :9000       |
| Console  | :9001       |

## Claude Code hook

Configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx ts-node /Users/monicalee/aislop/on-session-end.ts"
          }
        ]
      }
    ]
  }
}
```

## Transcript entry types

Each `.jsonl` line is one of:

- `user` — user message (content is a string or `ContentBlock[]`)
- `assistant` — assistant message (content is `ContentBlock[]`)
- `file-history-snapshot` — internal Claude Code snapshot metadata
