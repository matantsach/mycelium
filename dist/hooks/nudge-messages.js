"use strict";

// src/hooks/nudge-messages.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var basePath = process.env.MYCELIUM_BASE_PATH || (0, import_path.join)((0, import_os.homedir)(), ".mycelium");
var agentId = process.env.MYCELIUM_AGENT_ID;
var missionId = process.env.MYCELIUM_MISSION_ID;
if (agentId && missionId) {
  const inboxDir = (0, import_path.join)(basePath, "missions", missionId, "inbox", agentId);
  if ((0, import_fs.existsSync)(inboxDir)) {
    const files = (0, import_fs.readdirSync)(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor"
    );
    if (files.length > 0) {
      console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
    }
  }
}
