# CLAUDE.md

## Project Overview

Mycelium — multi-agent coordination plugin for CLI agents (Copilot CLI, Claude Code). Uses an Octopus-on-Mycelium architecture: a captain orchestrates autonomous arms across missions, with knowledge flowing through a shared filesystem substrate.

**Design spec:** `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md`
**Phase 1 plan:** `docs/superpowers/plans/2026-03-14-mycelium-phase1-foundation.md`
**Phase 2 spec:** `docs/superpowers/specs/2026-03-14-mycelium-phase2-protocol-migration-design.md`
**Phase 2 plan:** `docs/superpowers/plans/2026-03-14-mycelium-phase2-protocol-migration.md`

## Commands

```bash
npm install               # install dependencies
npm test                  # run all tests (vitest)
npm run test:watch        # watch mode
npx vitest run src/protocol/__tests__/frontmatter.test.ts  # single test file
npm run typecheck         # tsc --noEmit (strict mode)
npm run build             # bundle to dist/ via esbuild
npm run dev               # run MCP server directly with tsx
```

The `dist/` directory is committed because `copilot plugin install` does not run build steps. Always rebuild after changes.

## Architecture

### Protocol Layer (`src/protocol/`)

Filesystem-first coordination. All state under `~/.mycelium/`. Markdown files with YAML frontmatter.

- `frontmatter.ts` — `parseFrontmatter`/`stringifyFrontmatter` using `yaml` npm package
- `dirs.ts` — `initBasePath`, `resolveMissionPath`, `DEFAULT_BASE_PATH`
- `mission.ts` — `initMissionDir`, `writeMissionFile`, `readMissionFile`, `writeTaskFile`, `readTaskFile`, `writeMemberFile`, `listMissions`, `findTaskFile`, `updateTaskFileFrontmatter`
- `audit.ts` — `appendAuditEntry`, `AuditEntry` interface (append-only JSONL)
- `inbox.ts` — `writeMessage`, `readMessages`, `markRead`, `writeBroadcast`, `readBroadcasts` (filesystem-based messaging)

### MCP Server (`src/mcp-server/`)

5 atomic tools backed by SQLite. `server.ts` exports `createServer(basePath)` factory.

**Tool modules** (`src/mcp-server/tools/`):
- `team.ts` — `create_team` (dual-write: SQLite + filesystem)
- `tasks.ts` — `claim_task`, `complete_task`, `approve_task`, `reject_task` (all with dual-write + audit logging; `reject_task` also sends inbox message)

**Database** (`db.ts`): `TeamDB` class wraps `node-sqlite3-wasm`. Critical operations use `BEGIN IMMEDIATE` transactions. Task status state machine:

```
pending → in_progress (claim_task)
in_progress → completed | needs_review (complete_task)
needs_review → completed (approve_task) | in_progress (reject_task)
blocked → pending (auto-unblock when dependencies complete)
```

**Types** (`types.ts`): Interfaces + Zod schemas. Agent IDs: `^[a-z0-9-]+$`, max 50 chars.

### Adapters (`src/adapters/`)

- `types.ts` — `RuntimeAdapter` + `SpawnConfig` interfaces
- `copilot-cli.ts` — Copilot CLI adapter (wraps `spawn-teammate.sh`)
- `registry.ts` — `getAdapter(name, projectRoot)` factory

### Hooks (`src/hooks/`)

All hooks use `process.env.MYCELIUM_BASE_PATH || ~/.mycelium` for testability. Hooks avoid the `yaml` package — use regex/line-by-line parsing.

- `context-loader.ts` — `sessionStart`; captain mode lists active missions + loads `captain.md` attention queue, arm mode loads task details + inbox + knowledge + checkpoint
- `scope-enforcer.ts` — `preToolUse`; enforces file-scope per arm based on task's `scope` field
- `passive-monitor.ts` — `postToolUse`; captain mode detects stale arms/needs-review/all-complete, arm mode shows unread/priority messages
- `checkpoint.ts` — `sessionEnd`; writes checkpoint to in-progress task file for crash recovery
- `arm-cleanup.ts` — `agentStop`/`subagentStop`; marks member finished, appends audit, notifies lead if all tasks complete

### Skills, Agents, Scripts

- `skills/focus/SKILL.md` — Focus Mode (single-arm fire-and-forget)
- `skills/captain/SKILL.md` — Captain judgment engine, decomposition, monitoring, question resolution
- `skills/team-review/SKILL.md` — Mission retrospective and merge workflow
- `skills/team-coordinate/SKILL.md` — Filesystem protocol conventions (loaded for arm sessions)
- `agents/teammate.agent.md` — arm agent prompt (filesystem-first)
- `scripts/spawn-teammate.sh` — git worktree + tmux spawner

## Code Conventions

- **TypeScript strict mode** — all strict checks enabled
- **Zod** for all MCP tool input validation
- **Error handling in tools**: return `{ isError: true, content: [{ type: "text", text: message }] }`; DB methods throw
- **Authorization**: lead-only operations (`approve_task`, `reject_task`) enforced in the DB layer
- **Dual-write**: MCP tools write both SQLite (status authority) and filesystem (content authority)
- **Lazy reconciliation**: `claim_task` auto-creates SQLite rows from filesystem task files on first claim (supports captain creating tasks via filesystem only)
- **JSON fields**: `tasks.blocked_by` stored as JSON string, parsed in getTask

## Testing Patterns

Tests live in `__tests__/` directories adjacent to source.

**MCP tool tests** (`tools-*.test.ts`): Create server + client via `InMemoryTransport`, call tools through client, assert on parsed JSON responses.

**DB tests** (`db.test.ts`): Direct `TeamDB` instantiation with temp directory, testing state transitions and atomicity.

**Hook tests** (`context-loader.test.ts`): `execSync("npx tsx src/hooks/...")` with real data in temp dir, asserting on stdout.

## Roadmap

- **Phase 1** (shipped v0.5.0): Foundation — global state, Focus Mode, context-loader hook
- **Phase 2** (shipped): Protocol migration — dual-write, audit logging, inbox messaging, scope enforcement, crash recovery, passive monitoring, arm cleanup
- **Phase 3** (shipped): Captain intelligence — captain skill, team-review skill, claim_task reconciliation, captain.md lifecycle
- **Phase 4**: Mycelium knowledge — cross-session learning, multi-runtime adapters

## Adding a New MCP Tool

1. Add handler in `src/mcp-server/tools/*.ts`
2. Define input schema with Zod inline
3. Add DB method in `db.ts` if needed (use `BEGIN IMMEDIATE` for mutations)
4. Add tests in `src/mcp-server/__tests__/`
5. Run `npm test && npm run typecheck && npm run build`
