"use strict";

// src/hooks/arm-cleanup.ts
var import_fs2 = require("fs");
var import_path2 = require("path");
var import_os = require("os");

// src/protocol/audit.ts
var import_fs = require("fs");
var import_path = require("path");
function appendAuditEntry(missionPath2, entry) {
  const clean = { ts: entry.ts, agent: entry.agent, action: entry.action };
  if (entry.task_id !== void 0) clean.task_id = entry.task_id;
  if (entry.detail !== void 0) clean.detail = entry.detail;
  (0, import_fs.appendFileSync)(
    (0, import_path.join)(missionPath2, "audit.jsonl"),
    JSON.stringify(clean) + "\n"
  );
}

// src/hooks/arm-cleanup.ts
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path2.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
if (!agentId || !missionId) process.exit(0);
var missionPath = (0, import_path2.join)(basePath, "missions", missionId);
var memberFile = (0, import_path2.join)(missionPath, "members", `${agentId}.md`);
if ((0, import_fs2.existsSync)(memberFile)) {
  let content = (0, import_fs2.readFileSync)(memberFile, "utf-8");
  content = content.replace(/status:\s*active/, "status: finished");
  (0, import_fs2.writeFileSync)(memberFile, content, "utf-8");
}
appendAuditEntry(missionPath, { ts: Date.now(), agent: agentId, action: "session_end" });
var tasksDir = (0, import_path2.join)(missionPath, "tasks");
if ((0, import_fs2.existsSync)(tasksDir)) {
  const taskFiles = (0, import_fs2.readdirSync)(tasksDir).filter((f) => f.endsWith(".md"));
  if (taskFiles.length > 0) {
    let allComplete = true;
    for (const file of taskFiles) {
      const content = (0, import_fs2.readFileSync)((0, import_path2.join)(tasksDir, file), "utf-8");
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) {
        allComplete = false;
        continue;
      }
      let status;
      for (const line of fmMatch[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (kv?.[1] === "status") status = kv[2].trim();
      }
      if (status !== "completed") {
        allComplete = false;
        break;
      }
    }
    if (allComplete) {
      const timestamp = Date.now();
      const filename = `${timestamp}-${agentId}.md`;
      const body = `All tasks complete for mission ${missionId}`;
      const msgContent = `---
from: ${agentId}
priority: false
timestamp: ${timestamp}
---

${body}
`;
      const leadInbox = (0, import_path2.join)(missionPath, "inbox", "lead");
      (0, import_fs2.mkdirSync)(leadInbox, { recursive: true });
      (0, import_fs2.writeFileSync)((0, import_path2.join)(leadInbox, filename), msgContent, "utf-8");
    }
  }
}
