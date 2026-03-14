import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath = process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
const agentId = process.env.MYCELIUM_AGENT_ID;
const missionId = process.env.MYCELIUM_MISSION_ID;

if (!agentId || !missionId) process.exit(0);

const tasksDir = join(basePath, "missions", missionId, "tasks");
if (!existsSync(tasksDir)) process.exit(0);

const taskFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
let taskFilePath: string | undefined;

for (const file of taskFiles) {
  const content = readFileSync(join(tasksDir, file), "utf-8");
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) continue;
  let assignedTo: string | undefined;
  let status: string | undefined;
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] === "assigned_to") assignedTo = kv[2].trim();
    if (kv?.[1] === "status") status = kv[2].trim();
  }
  if (assignedTo === agentId && status === "in_progress") {
    taskFilePath = join(tasksDir, file);
    break;
  }
}

if (!taskFilePath) process.exit(0);

const now = Date.now();
const checkpointContent = `## Checkpoint\n<!-- written by sessionEnd hook -->\n- **Timestamp:** ${now}\n- **Status:** session ended`;

const fileContent = readFileSync(taskFilePath, "utf-8");
const checkpointIdx = fileContent.indexOf("## Checkpoint");

let updated: string;
if (checkpointIdx !== -1) {
  updated = fileContent.slice(0, checkpointIdx).trimEnd() + "\n\n" + checkpointContent + "\n";
} else {
  updated = fileContent.trimEnd() + "\n\n" + checkpointContent + "\n";
}
writeFileSync(taskFilePath, updated, "utf-8");

const progressDir = join(basePath, "missions", missionId, "progress");
mkdirSync(progressDir, { recursive: true });
const progressPath = join(progressDir, `${agentId}.md`);
const time = new Date(now).toISOString().slice(11, 16);
appendFileSync(progressPath, `\n## ${time} — session ended\n`, "utf-8");
