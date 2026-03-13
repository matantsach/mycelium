import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (agentId && missionId) {
  const inboxDir = join(basePath, "missions", missionId, "inbox", agentId);
  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor"
    );
    if (files.length > 0) {
      console.log(`[mycelium] ${files.length} unread message(s) in inbox`);
    }
  }
}
