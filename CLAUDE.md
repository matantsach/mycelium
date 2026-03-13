# CLAUDE.md

## Project Overview

Mycelium — multi-agent coordination plugin for CLI agents (Copilot CLI, Claude Code). Uses an Octopus-on-Mycelium architecture: a captain orchestrates autonomous arms across missions, with knowledge flowing through a shared filesystem substrate.

**Design spec:** `docs/superpowers/specs/2026-03-13-octopus-on-mycelium-design.md`
**Phase 1 plan:** `docs/superpowers/plans/2026-03-14-mycelium-phase1-foundation.md`

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
- `mission.ts` — `initMissionDir`, `writeMissionFile`, `readMissionFile`, `writeTaskFile`, `readTaskFile`, `writeMemberFile`, `listMissions`

### MCP Server (`src/mcp-server/`)

5 atomic tools backed by SQLite. `server.ts` exports `createServer(basePath)` factory.

**Tool modules** (`src/mcp-server/tools/`):
- `team.ts` — `create_team` (dual-write: SQLite + filesystem)
- `tasks.ts` — `claim_task`, `complete_task`, `approve_task`, `reject_task`

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

- `context-loader.ts` — `sessionStart`; reads `~/.mycelium/missions/`, lists active missions (simple regex parse, no yaml dep)
- `nudge-messages.ts` — `postToolUse`; placeholder, reads unread inbox count

### Skills, Agents, Scripts

- `skills/team-focus/SKILL.md` — Focus Mode (single-arm fire-and-forget)
- `agents/teammate.agent.md` — arm agent prompt
- `scripts/spawn-teammate.sh` — git worktree + tmux spawner

## Code Conventions

- **TypeScript strict mode** — all strict checks enabled
- **Zod** for all MCP tool input validation
- **Error handling in tools**: return `{ isError: true, content: [{ type: "text", text: message }] }`; DB methods throw
- **Authorization**: lead-only operations (`approve_task`, `reject_task`) enforced in the DB layer
- **Dual-write**: MCP tools write both SQLite (status authority) and filesystem (content authority)
- **JSON fields**: `tasks.blocked_by` stored as JSON string, parsed in getTask

## Testing Patterns

Tests live in `__tests__/` directories adjacent to source.

**MCP tool tests** (`tools-*.test.ts`): Create server + client via `InMemoryTransport`, call tools through client, assert on parsed JSON responses.

**DB tests** (`db.test.ts`): Direct `TeamDB` instantiation with temp directory, testing state transitions and atomicity.

**Hook tests** (`context-loader.test.ts`): `execSync("npx tsx src/hooks/...")` with real data in temp dir, asserting on stdout.

## Roadmap

- **Phase 1** (shipped v0.5.0): Foundation — global state, Focus Mode, context-loader hook
- **Phase 2**: Protocol migration — full mission decomposition, messaging, captain skill
- **Phase 3**: Captain intelligence — judgment engine, attention management
- **Phase 4**: Mycelium knowledge — cross-session learning, multi-runtime adapters

## Adding a New MCP Tool

1. Add handler in `src/mcp-server/tools/*.ts`
2. Define input schema with Zod inline
3. Add DB method in `db.ts` if needed (use `BEGIN IMMEDIATE` for mutations)
4. Add tests in `src/mcp-server/__tests__/`
5. Run `npm test && npm run typecheck && npm run build`
