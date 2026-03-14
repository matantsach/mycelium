import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { appendAuditEntry } from "../protocol/audit.js";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (!agentId || !missionId) process.exit(0);

const missionPath = join(basePath, "missions", missionId);

// 1. Update member file status to finished
const memberFile = join(missionPath, "members", `${agentId}.md`);
if (existsSync(memberFile)) {
  let content = readFileSync(memberFile, "utf-8");
  content = content.replace(/status:\s*active/, "status: finished");
  writeFileSync(memberFile, content, "utf-8");
}

// 2. Append audit entry
appendAuditEntry(missionPath, { ts: Date.now(), agent: agentId, action: "session_end" });

// 3. Check if all tasks are completed
const tasksDir = join(missionPath, "tasks");
if (existsSync(tasksDir)) {
  const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  if (taskFiles.length > 0) {
    let allComplete = true;
    for (const file of taskFiles) {
      const content = readFileSync(join(tasksDir, file), "utf-8");
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) { allComplete = false; continue; }
      let status: string | undefined;
      for (const line of fmMatch[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.+)$/);
        if (kv?.[1] === "status") status = kv[2].trim();
      }
      if (status !== "completed") { allComplete = false; break; }
    }
    if (allComplete) {
      // Notify lead — hand-crafted frontmatter to avoid yaml dependency
      const timestamp = Date.now();
      const filename = `${timestamp}-${agentId}.md`;
      const body = `All tasks complete for mission ${missionId}`;
      const msgContent = `---\nfrom: ${agentId}\npriority: false\ntimestamp: ${timestamp}\n---\n\n${body}\n`;
      const leadInbox = join(missionPath, "inbox", "lead");
      mkdirSync(leadInbox, { recursive: true });
      writeFileSync(join(leadInbox, filename), msgContent, "utf-8");
    }
  }
}
