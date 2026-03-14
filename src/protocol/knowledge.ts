import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
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
    .replace(/^-|-$/g, "")
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

export function readKnowledgeEntries(filePath: string): KnowledgeEntry[] {
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf-8");
  const { body } = parseFrontmatter(raw);
  if (!body.trim()) return [];

  const sections = body.split(/^## /m).filter((s) => s.trim());
  return sections.map((section) => {
    const lines = section.split("\n");
    const heading = lines[0].trim();
    const rest = lines.slice(1).join("\n");

    const tagMatch = rest.match(/^Tags:\s*(.+)$/m);
    const tags = tagMatch ? tagMatch[1].split(",").map((t) => t.trim()) : undefined;
    const content = rest
      .replace(/^Tags:\s*.+$/m, "")
      .trim();

    return { heading, content, ...(tags ? { tags } : {}) };
  });
}

export function collectTier1Entries(missionPath: string): KnowledgeEntry[] {
  const knowledgeDir = join(missionPath, "knowledge");
  if (!existsSync(knowledgeDir)) return [];

  const files = readdirSync(knowledgeDir).filter(
    (f) => f.endsWith(".md") && f !== "_shared.md"
  );

  const entries: KnowledgeEntry[] = [];
  for (const file of files) {
    entries.push(...readKnowledgeEntries(join(knowledgeDir, file)));
  }
  return entries;
}

export function promoteKnowledge(
  missionPath: string,
  entries: KnowledgeEntry[]
): void {
  const sharedPath = join(missionPath, "knowledge", "_shared.md");
  for (const entry of entries) {
    writeKnowledgeEntry(sharedPath, entry);
  }
}

export function promoteToGlobal(basePath: string, entry: KnowledgeEntry): void {
  const globalPath = join(basePath, "knowledge", "_global.md");
  writeKnowledgeEntry(globalPath, entry);
}

export function promoteToRepo(basePath: string, repo: string, entry: KnowledgeEntry): void {
  const repoPath = knowledgePath(basePath, { tier: 3, repo });
  writeKnowledgeEntry(repoPath, entry);
}

function scopeOverlaps(entryTags: string[], taskScope: string[]): boolean {
  for (const tag of entryTags) {
    for (const scope of taskScope) {
      // Simple prefix matching: tag "src/auth/" overlaps scope "src/auth/**"
      const scopeBase = scope.replace(/\*+$/, "").replace(/\/$/, "");
      const tagBase = tag.replace(/\/$/, "");
      if (tagBase.startsWith(scopeBase) || scopeBase.startsWith(tagBase)) {
        return true;
      }
    }
  }
  return false;
}

export function loadRelevantKnowledge(
  basePath: string,
  opts: {
    missionId?: string;
    agentId?: string;
    taskScope?: string[];
    repo?: string;
  }
): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];

  // Tier 3 global — always loaded
  const globalPath = join(basePath, "knowledge", "_global.md");
  entries.push(...readKnowledgeEntries(globalPath));

  // Tier 3 repo — loaded when repo is specified
  if (opts.repo) {
    const repoPath = knowledgePath(basePath, { tier: 3, repo: opts.repo });
    entries.push(...readKnowledgeEntries(repoPath));
  }

  // Tier 2 shared — loaded when missionId is specified
  if (opts.missionId) {
    const missionPath = join(basePath, "missions", opts.missionId);
    const sharedEntries = readKnowledgeEntries(join(missionPath, "knowledge", "_shared.md"));

    if (opts.taskScope?.length) {
      // Filter by scope overlap — entries without tags are treated as universal
      // and always pass through (intentional: untagged entries are general knowledge)
      entries.push(...sharedEntries.filter((e) =>
        !e.tags?.length || scopeOverlaps(e.tags, opts.taskScope!)
      ));
    } else {
      entries.push(...sharedEntries);
    }
  }

  // Tier 1 own — loaded when both missionId and agentId are specified
  if (opts.missionId && opts.agentId) {
    const ownPath = join(basePath, "missions", opts.missionId, "knowledge", `${opts.agentId}.md`);
    entries.push(...readKnowledgeEntries(ownPath));
  }

  return entries;
}
