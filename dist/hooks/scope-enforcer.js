"use strict";

// src/hooks/scope-enforcer.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
if (!agentId || !missionId) {
  process.exit(0);
}
var FILE_MUTATION_TOOLS = {
  // Claude Code
  Edit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["file_path"],
  // Copilot CLI
  editFile: ["path", "filePath"],
  writeFile: ["path", "filePath"],
  insertContent: ["path", "filePath"],
  replaceContent: ["path", "filePath"]
};
var stdinData = {};
try {
  const raw = (0, import_fs.readFileSync)("/dev/stdin", "utf-8").trim();
  stdinData = JSON.parse(raw);
} catch {
  process.exit(0);
}
var toolName = stdinData.toolName ?? "";
var input = stdinData.input ?? {};
if (!(toolName in FILE_MUTATION_TOOLS)) {
  process.exit(0);
}
var filePath;
var pathKeys = FILE_MUTATION_TOOLS[toolName] ?? [];
for (const key of pathKeys) {
  if (typeof input[key] === "string") {
    filePath = input[key];
    break;
  }
}
if (!filePath) {
  process.exit(0);
}
var tasksDir = (0, import_path.join)(basePath, "missions", missionId, "tasks");
if (!(0, import_fs.existsSync)(tasksDir)) {
  process.exit(0);
}
var taskScope = null;
var taskFiles = (0, import_fs.readdirSync)(tasksDir).filter((f) => f.endsWith(".md"));
for (const taskFile of taskFiles) {
  const taskPath = (0, import_path.join)(tasksDir, taskFile);
  let content;
  try {
    content = (0, import_fs.readFileSync)(taskPath, "utf-8");
  } catch {
    continue;
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const fm = match[1];
  let assignedTo;
  let status;
  for (const line of fm.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }
  if (assignedTo !== agentId || status !== "in_progress") continue;
  const inlineMatch = fm.match(/^scope:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    const items = inlineMatch[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    taskScope = items;
  } else {
    const lines = fm.split("\n");
    const scopeIdx = lines.findIndex((l) => /^scope:\s*$/.test(l));
    if (scopeIdx !== -1) {
      const items = [];
      for (let i = scopeIdx + 1; i < lines.length; i++) {
        const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          items.push(itemMatch[1].trim());
        } else if (lines[i].trim() !== "" && !/^\s/.test(lines[i])) {
          break;
        }
      }
      taskScope = items;
    } else {
      taskScope = null;
    }
  }
  break;
}
if (taskScope === null) {
  process.exit(0);
}
function matchesScope(filePath2, scopeEntries) {
  for (const entry of scopeEntries) {
    if (entry.endsWith("/**")) {
      const prefix = entry.slice(0, -3);
      if (filePath2 === prefix || filePath2.startsWith(prefix + "/")) {
        return true;
      }
    } else {
      if (filePath2 === entry) {
        return true;
      }
    }
  }
  return false;
}
if (matchesScope(filePath, taskScope)) {
  process.exit(0);
}
process.stdout.write(
  JSON.stringify({
    permissionDecision: "deny",
    permissionDecisionReason: `File outside task scope: ${filePath}`
  }) + "\n"
);
process.exit(0);
