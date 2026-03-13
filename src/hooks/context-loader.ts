import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const missionsDir = join(basePath, "missions");

if (existsSync(missionsDir)) {
  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const active: Array<{ id: string; goal: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (!existsSync(missionFile)) continue;

    const content = readFileSync(missionFile, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) continue;

    // Simple line-by-line parse — avoids yaml dependency in hook bundle
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
