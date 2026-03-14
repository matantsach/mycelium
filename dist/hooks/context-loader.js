"use strict";

// src/hooks/context-loader.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
var missionsDir = (0, import_path.join)(basePath, "missions");
function parseFmField(content, field) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return void 0;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === field) return kv[2].trim();
  }
  return void 0;
}
if (agentId && missionId) {
  const mPath = (0, import_path.join)(missionsDir, missionId);
  if (!(0, import_fs.existsSync)(mPath)) process.exit(0);
  console.log(`[mycelium] Arm ${agentId} \u2014 mission ${missionId}`);
  console.log(`Use the team-coordinate skill for filesystem protocol conventions.`);
  const tasksDir = (0, import_path.join)(mPath, "tasks");
  if ((0, import_fs.existsSync)(tasksDir)) {
    const taskFiles = (0, import_fs.readdirSync)(tasksDir).filter((f) => f.endsWith(".md"));
    for (const file of taskFiles) {
      const content = (0, import_fs.readFileSync)((0, import_path.join)(tasksDir, file), "utf-8");
      const assignedTo = parseFmField(content, "assigned_to");
      const status = parseFmField(content, "status");
      if (assignedTo === agentId && (status === "in_progress" || status === "pending")) {
        console.log(`
--- Task: ${file} ---`);
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        if (bodyMatch) console.log(bodyMatch[1].trim());
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          let priorIds = [];
          const ptInline = fmMatch[1].match(/^prior_tasks:\s*\[([^\]]*)\]/m);
          if (ptInline && ptInline[1].trim()) {
            priorIds = ptInline[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          } else {
            const ptBlock = fmMatch[1].match(/^prior_tasks:\s*$/m);
            if (ptBlock) {
              const fmLines = fmMatch[1].split("\n");
              const ptIdx = fmLines.findIndex((l) => l.match(/^prior_tasks:\s*$/));
              for (let i = ptIdx + 1; i < fmLines.length; i++) {
                const itemMatch = fmLines[i].match(/^\s+-\s+(\d+)/);
                if (itemMatch) priorIds.push(parseInt(itemMatch[1], 10));
                else break;
              }
            }
          }
          for (const priorId of priorIds) {
            const prefix = String(priorId).padStart(3, "0") + "-";
            const priorFile = taskFiles.find((f) => f.startsWith(prefix));
            if (priorFile) {
              const priorContent = (0, import_fs.readFileSync)((0, import_path.join)(tasksDir, priorFile), "utf-8");
              const outputMatch = priorContent.match(/## Output\r?\n([\s\S]*?)(?=\n## |$)/);
              if (outputMatch && outputMatch[1].trim()) {
                console.log(`
--- Prior Task ${priorId} Output ---`);
                console.log(outputMatch[1].trim());
              }
            }
          }
        }
        break;
      }
    }
  }
  const inboxDir = (0, import_path.join)(mPath, "inbox", agentId);
  if ((0, import_fs.existsSync)(inboxDir)) {
    const files = (0, import_fs.readdirSync)(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
    );
    if (files.length > 0) {
      console.log(`
--- Inbox (${files.length} unread) ---`);
      for (const file of files) {
        const content = (0, import_fs.readFileSync)((0, import_path.join)(inboxDir, file), "utf-8");
        const from = parseFmField(content, "from") ?? "unknown";
        const priority = parseFmField(content, "priority");
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const prefix = priority === "true" ? "PRIORITY " : "";
        console.log(`  ${prefix}From ${from}: ${bodyMatch ? bodyMatch[1].trim() : "(empty)"}`);
      }
    }
  }
  const knowledgeDir = (0, import_path.join)(mPath, "knowledge");
  const sharedKnowledge = (0, import_path.join)(knowledgeDir, "_shared.md");
  const ownKnowledge = (0, import_path.join)(knowledgeDir, `${agentId}.md`);
  const knowledgeFiles = [sharedKnowledge, ownKnowledge].filter(import_fs.existsSync);
  if (knowledgeFiles.length > 0) {
    console.log("\n--- Knowledge ---");
    for (const kf of knowledgeFiles) {
      const content = (0, import_fs.readFileSync)(kf, "utf-8");
      const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      if (bodyMatch && bodyMatch[1].trim()) console.log(bodyMatch[1].trim());
    }
  }
} else {
  if (!(0, import_fs.existsSync)(missionsDir)) process.exit(0);
  const entries = (0, import_fs.readdirSync)(missionsDir, { withFileTypes: true });
  const active = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = (0, import_path.join)(missionsDir, entry.name, "mission.md");
    if (!(0, import_fs.existsSync)(missionFile)) continue;
    const content = (0, import_fs.readFileSync)(missionFile, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) continue;
    let id = entry.name;
    let status = "active";
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv?.[1] === "id") id = kv[2].trim();
      if (kv?.[1] === "status") status = kv[2].trim();
    }
    if (status !== "active") continue;
    const goalMatch = match[2].match(/^#\s+(.+)$/m);
    active.push({ id, goal: goalMatch ? goalMatch[1] : "(no goal)" });
  }
  if (active.length > 0) {
    console.log("[mycelium] Active missions:");
    for (const m of active) console.log(`  ${m.id}: ${m.goal}`);
  }
}
