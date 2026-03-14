import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;
const missionsDir = join(basePath, "missions");

function parseFmField(content: string, field: string): string | undefined {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return undefined;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === field) return kv[2].trim();
  }
  return undefined;
}

if (agentId && missionId) {
  // ARM SESSION
  const mPath = join(missionsDir, missionId);
  if (!existsSync(mPath)) process.exit(0);

  console.log(`[mycelium] Arm ${agentId} — mission ${missionId}`);
  console.log(`Use the team-coordinate skill for filesystem protocol conventions.`);

  // Find assigned task
  const tasksDir = join(mPath, "tasks");
  if (existsSync(tasksDir)) {
    const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
    for (const file of taskFiles) {
      const content = readFileSync(join(tasksDir, file), "utf-8");
      const assignedTo = parseFmField(content, "assigned_to");
      const status = parseFmField(content, "status");

      if (assignedTo === agentId && (status === "in_progress" || status === "pending")) {
        console.log(`\n--- Task: ${file} ---`);
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        if (bodyMatch) console.log(bodyMatch[1].trim());

        // Load prior task outputs
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          let priorIds: number[] = [];
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
              const priorContent = readFileSync(join(tasksDir, priorFile), "utf-8");
              const outputMatch = priorContent.match(/## Output\r?\n([\s\S]*?)(?=\n## |$)/);
              if (outputMatch && outputMatch[1].trim()) {
                console.log(`\n--- Prior Task ${priorId} Output ---`);
                console.log(outputMatch[1].trim());
              }
            }
          }
        }
        break;
      }
    }
  }

  // Load unread inbox messages
  const inboxDir = join(mPath, "inbox", agentId);
  if (existsSync(inboxDir)) {
    const files = readdirSync(inboxDir).filter(
      (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
    );
    if (files.length > 0) {
      console.log(`\n--- Inbox (${files.length} unread) ---`);
      for (const file of files) {
        const content = readFileSync(join(inboxDir, file), "utf-8");
        const from = parseFmField(content, "from") ?? "unknown";
        const priority = parseFmField(content, "priority");
        const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
        const prefix = priority === "true" ? "PRIORITY " : "";
        console.log(`  ${prefix}From ${from}: ${bodyMatch ? bodyMatch[1].trim() : "(empty)"}`);
      }
    }
  }

  // Load knowledge
  const knowledgeDir = join(mPath, "knowledge");
  const sharedKnowledge = join(knowledgeDir, "_shared.md");
  const ownKnowledge = join(knowledgeDir, `${agentId}.md`);
  const knowledgeFiles = [sharedKnowledge, ownKnowledge].filter(existsSync);
  if (knowledgeFiles.length > 0) {
    console.log("\n--- Knowledge ---");
    for (const kf of knowledgeFiles) {
      const content = readFileSync(kf, "utf-8");
      const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
      if (bodyMatch && bodyMatch[1].trim()) console.log(bodyMatch[1].trim());
    }
  }
} else {
  // CAPTAIN SESSION
  if (!existsSync(missionsDir)) process.exit(0);
  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const active: Array<{ id: string; goal: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (!existsSync(missionFile)) continue;
    const content = readFileSync(missionFile, "utf-8");
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
