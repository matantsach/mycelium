"use strict";

// src/hooks/passive-monitor.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
var STALE_THRESHOLD_MS = 5 * 60 * 1e3;
function parseField(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : void 0;
}
function hasPriority(content) {
  return /^priority:\s*true\s*$/m.test(content);
}
if (agentId) {
  const resolvedMissionId = missionId || "unknown";
  const inboxDir = (0, import_path.join)(basePath, "missions", resolvedMissionId, "inbox", agentId);
  if ((0, import_fs.existsSync)(inboxDir)) {
    const files = (0, import_fs.readdirSync)(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor" && !f.startsWith(".")
    );
    if (files.length > 0) {
      let hasPriorityMsg = false;
      for (const file of files) {
        try {
          const content = (0, import_fs.readFileSync)((0, import_path.join)(inboxDir, file), "utf-8");
          if (hasPriority(content)) {
            hasPriorityMsg = true;
            break;
          }
        } catch {
        }
      }
      if (hasPriorityMsg) {
        console.log("[mycelium] PRIORITY message from lead in inbox");
      } else {
        console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
      }
    }
  }
} else {
  const missionsDir = (0, import_path.join)(basePath, "missions");
  if (!(0, import_fs.existsSync)(missionsDir)) process.exit(0);
  const now = Date.now();
  const entries = (0, import_fs.readdirSync)(missionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mPath = (0, import_path.join)(missionsDir, entry.name);
    const missionFile = (0, import_path.join)(mPath, "mission.md");
    if (!(0, import_fs.existsSync)(missionFile)) continue;
    let missionContent;
    try {
      missionContent = (0, import_fs.readFileSync)(missionFile, "utf-8");
    } catch {
      continue;
    }
    const status = parseField(missionContent, "status");
    if (status !== "active") continue;
    const mId = parseField(missionContent, "id") || entry.name;
    const signals = [];
    const membersDir = (0, import_path.join)(mPath, "members");
    const progressDir = (0, import_path.join)(mPath, "progress");
    if ((0, import_fs.existsSync)(membersDir)) {
      const memberFiles = (0, import_fs.readdirSync)(membersDir).filter(
        (f) => f.endsWith(".md")
      );
      for (const memberFile of memberFiles) {
        const armId = memberFile.replace(/\.md$/, "");
        let mtime;
        const progressFile = (0, import_path.join)(progressDir, `${armId}.md`);
        if ((0, import_fs.existsSync)(progressFile)) {
          try {
            mtime = (0, import_fs.statSync)(progressFile).mtimeMs;
          } catch {
          }
        }
        if (mtime === void 0) {
          try {
            mtime = (0, import_fs.statSync)((0, import_path.join)(membersDir, memberFile)).mtimeMs;
          } catch {
          }
        }
        if (mtime !== void 0 && now - mtime > STALE_THRESHOLD_MS) {
          signals.push(`stale arm: ${armId}`);
        }
      }
    }
    const tasksDir = (0, import_path.join)(mPath, "tasks");
    if ((0, import_fs.existsSync)(tasksDir)) {
      const taskFiles = (0, import_fs.readdirSync)(tasksDir).filter((f) => f.endsWith(".md"));
      let allCompleted = taskFiles.length > 0;
      let hasNeedsReview = false;
      for (const taskFile of taskFiles) {
        let taskContent;
        try {
          taskContent = (0, import_fs.readFileSync)((0, import_path.join)(tasksDir, taskFile), "utf-8");
        } catch {
          allCompleted = false;
          continue;
        }
        const taskStatus = parseField(taskContent, "status");
        if (taskStatus === "needs_review") {
          hasNeedsReview = true;
        }
        if (taskStatus !== "completed") {
          allCompleted = false;
        }
      }
      if (hasNeedsReview) {
        signals.push("task needs review");
      }
      if (allCompleted) {
        signals.push("all tasks complete");
      }
    }
    if (signals.length > 0) {
      console.log(`[mycelium] ${mId}: ${signals.join(" | ")}`);
    }
  }
}
