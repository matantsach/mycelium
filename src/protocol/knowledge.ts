import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

export interface KnowledgeEntry {
  heading: string;
  content: string;
  tags?: string[];
}

export interface KnowledgePathOpts {
  tier: 1 | 2 | 3;
  missionId?: string;
  agentId?: string;
  repo?: string;
}

function slugifyRepo(repo: string): string {
  return repo
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

export function knowledgePath(basePath: string, opts: KnowledgePathOpts): string {
  if (opts.tier === 1) {
    if (!opts.missionId || !opts.agentId) throw new Error("Tier 1 requires missionId and agentId");
    return join(basePath, "missions", opts.missionId, "knowledge", `${opts.agentId}.md`);
  }
  if (opts.tier === 2) {
    if (!opts.missionId) throw new Error("Tier 2 requires missionId");
    return join(basePath, "missions", opts.missionId, "knowledge", "_shared.md");
  }
  // Tier 3
  if (opts.repo) {
    return join(basePath, "knowledge", "repos", `${slugifyRepo(opts.repo)}.md`);
  }
  return join(basePath, "knowledge", "_global.md");
}

export function writeKnowledgeEntry(filePath: string, entry: KnowledgeEntry): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const tagLine = entry.tags?.length ? `\nTags: ${entry.tags.join(", ")}\n` : "";
  const section = `\n## ${entry.heading}\n\n${entry.content}\n${tagLine}`;

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const { data, body } = parseFrontmatter(existing);
    data.updated_at = Date.now();
    const newBody = body + section;
    writeFileSync(filePath, stringifyFrontmatter(data, newBody), "utf-8");
  } else {
    const data: Record<string, unknown> = { type: "knowledge", updated_at: Date.now() };
    const body = section.trimStart();
    writeFileSync(filePath, stringifyFrontmatter(data, body), "utf-8");
  }
}

// Stub for Task 2 — not yet implemented
export function readKnowledgeEntries(_filePath: string): KnowledgeEntry[] {
  return [];
}
