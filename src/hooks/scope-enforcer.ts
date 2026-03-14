import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

// Captain session (no env vars) → exit silently
if (!agentId || !missionId) {
  process.exit(0);
}

// File-mutation tool names and their path argument keys
const FILE_MUTATION_TOOLS: Record<string, string[]> = {
  // Claude Code
  Edit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["file_path"],
  // Copilot CLI
  editFile: ["path", "filePath"],
  writeFile: ["path", "filePath"],
  insertContent: ["path", "filePath"],
  replaceContent: ["path", "filePath"],
};

// Read stdin as JSON
let stdinData: { toolName?: string; input?: Record<string, unknown> } = {};
try {
  const raw = readFileSync("/dev/stdin", "utf-8").trim();
  stdinData = JSON.parse(raw) as { toolName?: string; input?: Record<string, unknown> };
} catch {
  // Unparseable stdin → allow
  process.exit(0);
}

const toolName = stdinData.toolName ?? "";
const input = stdinData.input ?? {};

// If toolName is not a file-mutation tool → exit silently
if (!(toolName in FILE_MUTATION_TOOLS)) {
  process.exit(0);
}

// Extract file path from input args
let filePath: string | undefined;
const pathKeys = FILE_MUTATION_TOOLS[toolName] ?? [];
for (const key of pathKeys) {
  if (typeof input[key] === "string") {
    filePath = input[key] as string;
    break;
  }
}

if (!filePath) {
  // Can't determine path → allow
  process.exit(0);
}

// Find agent's in-progress task file
const tasksDir = join(basePath, "missions", missionId, "tasks");

if (!existsSync(tasksDir)) {
  // No tasks dir → allow
  process.exit(0);
}

let taskScope: string[] | null = null;

const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
for (const taskFile of taskFiles) {
  const taskPath = join(tasksDir, taskFile);
  let content: string;
  try {
    content = readFileSync(taskPath, "utf-8");
  } catch {
    continue;
  }

  // Parse frontmatter with regex — no yaml dependency
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;

  const fm = match[1];

  // Check assigned_to and status
  let assignedTo: string | undefined;
  let status: string | undefined;

  for (const line of fm.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }

  if (assignedTo !== agentId || status !== "in_progress") continue;

  // Found the agent's in-progress task — parse scope field
  // Handles both inline: scope: [a, b, c] and block format:
  //   scope:
  //     - a
  //     - b
  const inlineMatch = fm.match(/^scope:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    const items = inlineMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    taskScope = items;
  } else {
    // Check for block list format
    const lines = fm.split("\n");
    const scopeIdx = lines.findIndex((l) => /^scope:\s*$/.test(l));
    if (scopeIdx !== -1) {
      const items: string[] = [];
      for (let i = scopeIdx + 1; i < lines.length; i++) {
        const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          items.push(itemMatch[1].trim());
        } else if (lines[i].trim() !== "" && !/^\s/.test(lines[i])) {
          // Non-indented line — end of block
          break;
        }
      }
      taskScope = items;
    } else {
      // No scope field → allow
      taskScope = null;
    }
  }
  break;
}

// No task file found → allow
if (taskScope === null) {
  process.exit(0);
}

// Check if file matches scope
function matchesScope(filePath: string, scopeEntries: string[]): boolean {
  for (const entry of scopeEntries) {
    // Glob with /**
    if (entry.endsWith("/**")) {
      const prefix = entry.slice(0, -3); // remove /**
      if (filePath === prefix || filePath.startsWith(prefix + "/")) {
        return true;
      }
    } else {
      // Exact match
      if (filePath === entry) {
        return true;
      }
    }
  }
  return false;
}

if (matchesScope(filePath, taskScope)) {
  // Within scope → exit silently
  process.exit(0);
}

// Outside scope (including empty scope array) → deny
process.stdout.write(
  JSON.stringify({
    permissionDecision: "deny",
    permissionDecisionReason: `File outside task scope: ${filePath}`,
  }) + "\n"
);
process.exit(0);
