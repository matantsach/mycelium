# mycelium

[![CI](https://github.com/matantsach/mycelium/actions/workflows/ci.yml/badge.svg)](https://github.com/matantsach/mycelium/actions/workflows/ci.yml)

Multi-agent coordination plugin for CLI agents. A captain decomposes complex goals into parallel subtasks, spawns autonomous arms that work independently, and coordinates them via a shared protocol — filesystem-first with SQLite for atomic operations.

## Install

```bash
copilot plugin install matantsach/mycelium
```

## Quick Start

### Focus Mode (fire-and-forget)

```
/focus run integration tests and fix failures
/focus investigate bug PROJ-1234 in the ADX logs
/focus add unit tests for src/payments/
```

Focus Mode spawns a single arm to handle a task autonomously. You get control back immediately. Designed for 5-10x daily use.

## Architecture

**Filesystem-first protocol.** All state lives under `~/.mycelium/`. Markdown files with YAML frontmatter for missions, tasks, members, and knowledge. Only 5 operations needing atomicity go through the MCP server (SQLite).

**Dual-write rule.** MCP tools write to both SQLite (status authority) and filesystem (content authority). Agents read the filesystem directly — it's free and always available.

### MCP Tools (5 atomic operations)

| Tool | Description |
|------|-------------|
| `create_team` | Create a mission, register caller as lead |
| `claim_task` | Atomically claim a pending task |
| `complete_task` | Mark task completed or needs_review |
| `approve_task` | Lead-only: approve a reviewed task |
| `reject_task` | Lead-only: reject with feedback |

### Directory Structure

```
~/.mycelium/
├── missions/
│   └── {mission-id}/
│       ├── mission.md          # Goal, status, config
│       ├── tasks/              # Task files (001-slug.md)
│       ├── members/            # Member files (agent-id.md)
│       ├── inbox/              # Per-agent message inboxes
│       ├── progress/           # Per-agent progress logs
│       └── knowledge/          # Mission-scoped learnings
├── knowledge/                  # Global knowledge substrate
│   └── repos/                  # Per-repo accumulated knowledge
├── templates/                  # Reusable mission templates
└── adapters/                   # Runtime adapter configs
```

### Agents

- **Captain** — orchestrator that decomposes goals, spawns arms, monitors progress (Phase 3)
- **Teammate (arm)** — autonomous worker that claims tasks, does work, reports results

### Runtime Adapters

Pluggable spawning mechanism for different CLI agents:
- **Copilot CLI** — spawns teammates in tmux panes with git worktrees

## Tmux Support

Run inside a tmux session for true parallel execution — each arm gets its own pane:

```bash
tmux
# then inside tmux:
/focus refactor the auth module and add tests
```

### Model Selection

Arms default to `claude-sonnet-4-6`. Customize with:

```bash
export TEAMMATE_MODEL=claude-opus-4-6
```

## Development

```bash
npm install
npm test              # run all 55 tests
npm run build         # bundle to dist/
npm run typecheck     # strict mode type check
npm run test:watch    # watch mode
```

## Roadmap

- **Phase 1** (shipped): Foundation — global state, Focus Mode, context-loader hook
- **Phase 2** (shipped): Protocol migration — full mission decomposition, messaging
- **Phase 3** (shipped): Captain intelligence — judgment engine, attention management
- **Phase 4** (shipped): Mycelium knowledge — 3-tier knowledge promotion, enhanced context loading, Claude Code + Codex CLI adapters, mission templates

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
