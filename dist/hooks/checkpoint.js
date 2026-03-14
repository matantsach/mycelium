"use strict";

// src/hooks/checkpoint.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
if (!agentId || !missionId) process.exit(0);
var tasksDir = (0, import_path.join)(basePath, "missions", missionId, "tasks");
if (!(0, import_fs.existsSync)(tasksDir)) process.exit(0);
var taskFiles = (0, import_fs.readdirSync)(tasksDir).filter((f) => f.endsWith(".md"));
var taskFilePath;
for (const file of taskFiles) {
  const content = (0, import_fs.readFileSync)((0, import_path.join)(tasksDir, file), "utf-8");
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;
  let assignedTo;
  let status;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }
  if (assignedTo === agentId && status === "in_progress") {
    taskFilePath = (0, import_path.join)(tasksDir, file);
    break;
  }
}
if (!taskFilePath) process.exit(0);
var now = Date.now();
var checkpointContent = `## Checkpoint
<!-- written by sessionEnd hook -->
- **Timestamp:** ${now}
- **Status:** session ended`;
var fileContent = (0, import_fs.readFileSync)(taskFilePath, "utf-8");
var checkpointIdx = fileContent.indexOf("## Checkpoint");
var updated;
if (checkpointIdx !== -1) {
  updated = fileContent.slice(0, checkpointIdx).trimEnd() + "\n\n" + checkpointContent + "\n";
} else {
  updated = fileContent.trimEnd() + "\n\n" + checkpointContent + "\n";
}
(0, import_fs.writeFileSync)(taskFilePath, updated, "utf-8");
var progressDir = (0, import_path.join)(basePath, "missions", missionId, "progress");
(0, import_fs.mkdirSync)(progressDir, { recursive: true });
var progressPath = (0, import_path.join)(progressDir, `${agentId}.md`);
var time = new Date(now).toISOString().slice(11, 16);
(0, import_fs.appendFileSync)(progressPath, `
## ${time} \u2014 session ended
`, "utf-8");
