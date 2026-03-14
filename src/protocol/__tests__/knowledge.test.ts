import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeKnowledgeEntry,
  readKnowledgeEntries,
  knowledgePath,
} from "../knowledge.js";
import { parseFrontmatter } from "../frontmatter.js";

describe("knowledge protocol", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-knowledge-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("knowledgePath", () => {
    it("returns Tier 1 path for arm knowledge", () => {
      const p = knowledgePath(tmpDir, { tier: 1, missionId: "m1", agentId: "arm-1" });
      expect(p).toBe(join(tmpDir, "missions", "m1", "knowledge", "arm-1.md"));
    });

    it("returns Tier 2 path for shared knowledge", () => {
      const p = knowledgePath(tmpDir, { tier: 2, missionId: "m1" });
      expect(p).toBe(join(tmpDir, "missions", "m1", "knowledge", "_shared.md"));
    });

    it("returns Tier 3 global path", () => {
      const p = knowledgePath(tmpDir, { tier: 3 });
      expect(p).toBe(join(tmpDir, "knowledge", "_global.md"));
    });

    it("returns Tier 3 repo path", () => {
      const p = knowledgePath(tmpDir, { tier: 3, repo: "/Users/dev/my-project" });
      expect(p).toBe(join(tmpDir, "knowledge", "repos", "users-dev-my-project.md"));
    });

    it("throws for Tier 1 without missionId or agentId", () => {
      expect(() => knowledgePath(tmpDir, { tier: 1 })).toThrow("Tier 1 requires");
    });

    it("throws for Tier 2 without missionId", () => {
      expect(() => knowledgePath(tmpDir, { tier: 2 })).toThrow("Tier 2 requires");
    });

    it("strips trailing slash from repo path", () => {
      const p = knowledgePath(tmpDir, { tier: 3, repo: "/my/repo/" });
      expect(p).toBe(join(tmpDir, "knowledge", "repos", "my-repo.md"));
    });
  });

  describe("writeKnowledgeEntry", () => {
    it("creates file with frontmatter on first write", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "_global.md");

      writeKnowledgeEntry(filePath, {
        heading: "SQLite Concurrency",
        content: "Always use BEGIN IMMEDIATE for write transactions.",
        tags: ["sqlite", "concurrency"],
      });

      expect(existsSync(filePath)).toBe(true);
      const { data, body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
      expect(data.type).toBe("knowledge");
      expect(data.updated_at).toBeTypeOf("number");
      expect(body).toContain("## SQLite Concurrency");
      expect(body).toContain("Always use BEGIN IMMEDIATE");
      expect(body).toContain("Tags: sqlite, concurrency");
    });

    it("appends to existing file without duplicating frontmatter", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "_global.md");

      writeKnowledgeEntry(filePath, {
        heading: "Entry One",
        content: "First discovery.",
      });
      writeKnowledgeEntry(filePath, {
        heading: "Entry Two",
        content: "Second discovery.",
      });

      const raw = readFileSync(filePath, "utf-8");
      const fmMatches = raw.match(/^---/gm);
      expect(fmMatches).toHaveLength(2); // opening + closing
      const { body } = parseFrontmatter(raw);
      expect(body).toContain("## Entry One");
      expect(body).toContain("## Entry Two");
    });

    it("writes entry without tags when none provided", () => {
      const kPath = join(tmpDir, "knowledge");
      mkdirSync(kPath, { recursive: true });
      const filePath = join(kPath, "arm-1.md");

      writeKnowledgeEntry(filePath, {
        heading: "No Tags Entry",
        content: "Some content.",
      });

      const { body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
      expect(body).toContain("## No Tags Entry");
      expect(body).not.toContain("Tags:");
    });
  });
});
