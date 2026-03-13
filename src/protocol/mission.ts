import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "./frontmatter.js";
import type { FrontmatterResult } from "./frontmatter.js";

const MISSION_SUBDIRS = [
  "tasks",
  "members",
  "inbox",
  "inbox/_broadcast",
  "progress",
  "knowledge",
];

export function initMissionDir(missionPath: string): void {
  for (const sub of MISSION_SUBDIRS) {
    mkdirSync(join(missionPath, sub), { recursive: true });
  }
}

export function writeMissionFile(
  missionPath: string,
  data: Record<string, unknown>,
  goal: string
): void {
  const content = stringifyFrontmatter(data, `# ${goal}`);
  writeFileSync(join(missionPath, "mission.md"), content, "utf-8");
}

export function readMissionFile(missionPath: string): FrontmatterResult {
  const content = readFileSync(join(missionPath, "mission.md"), "utf-8");
  return parseFrontmatter(content);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function writeTaskFile(
  missionPath: string,
  data: Record<string, unknown>,
  title: string,
  description: string
): void {
  const id = data.id as number;
  const slug = slugify(title);
  const filename = `${String(id).padStart(3, "0")}-${slug}.md`;
  const body = `# ${title}\n\n${description}\n\n## Context\n<!-- Additional context for the arm -->\n\n## Output\n<!-- filled by teammate on completion -->\n\n### Files Changed\n### Tests Added\n### Decisions Made\n### Open Questions\n\n## Checkpoint\n<!-- written by sessionEnd hook on crash/timeout -->`;
  const content = stringifyFrontmatter(data, body);
  writeFileSync(join(missionPath, "tasks", filename), content, "utf-8");
}

export function readTaskFile(filePath: string): FrontmatterResult {
  return parseFrontmatter(readFileSync(filePath, "utf-8"));
}

export function writeMemberFile(
  missionPath: string,
  data: Record<string, unknown>
): void {
  const agentId = data.agent_id as string;
  const content = stringifyFrontmatter(data, "");
  writeFileSync(
    join(missionPath, "members", `${agentId}.md`),
    content,
    "utf-8"
  );
}

export function listMissions(basePath: string): FrontmatterResult[] {
  const missionsDir = join(basePath, "missions");
  if (!existsSync(missionsDir)) return [];

  const entries = readdirSync(missionsDir, { withFileTypes: true });
  const missions: FrontmatterResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const missionFile = join(missionsDir, entry.name, "mission.md");
    if (existsSync(missionFile)) {
      missions.push(readMissionFile(join(missionsDir, entry.name)));
    }
  }
  return missions;
}
