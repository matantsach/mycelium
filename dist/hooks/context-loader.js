"use strict";

// src/hooks/context-loader.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var missionsDir = (0, import_path.join)(basePath, "missions");
if ((0, import_fs.existsSync)(missionsDir)) {
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
    for (const m of active) {
      console.log(`  ${m.id}: ${m.goal}`);
    }
  }
}
