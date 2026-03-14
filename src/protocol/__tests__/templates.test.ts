import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initBasePath } from "../dirs.js";
import {
  writeTemplate,
  readTemplate,
  listTemplates,
  instantiateTemplate,
} from "../templates.js";

describe("template protocol", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-templates-test-"));
    initBasePath(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("writeTemplate", () => {
    it("writes a template file to the templates directory", () => {
      writeTemplate(tmpDir, "test-and-fix", {
        name: "test-and-fix",
        description: "Run tests, identify failures, fix them",
        tasks: [
          { title: "Run tests", scope: ["**/*.test.*"], description: "Run test suite and document failures." },
          { title: "Fix failures", scope: ["src/**"], blocked_by: [1], description: "Fix identified failures." },
        ],
      }, "A two-arm pattern for test-then-fix workflows.");

      const template = readTemplate(tmpDir, "test-and-fix");
      expect(template).toBeTruthy();
      expect(template!.data.name).toBe("test-and-fix");
      expect(template!.data.description).toBe("Run tests, identify failures, fix them");
      expect(template!.data.tasks).toHaveLength(2);
      expect(template!.body).toContain("two-arm pattern");
    });
  });

  describe("readTemplate", () => {
    it("returns null for non-existent template", () => {
      const result = readTemplate(tmpDir, "nonexistent");
      expect(result).toBeNull();
    });

    it("reads template data and body", () => {
      writeTemplate(tmpDir, "simple", {
        name: "simple",
        description: "A simple template",
        tasks: [{ title: "Do thing", scope: ["src/**"], description: "Do the thing." }],
      }, "Simple single-task template.");

      const template = readTemplate(tmpDir, "simple");
      expect(template).toBeTruthy();
      expect(template!.data.tasks).toHaveLength(1);
      expect((template!.data.tasks as Array<{ title: string }>)[0].title).toBe("Do thing");
    });
  });

  describe("listTemplates", () => {
    it("returns empty array when no templates exist", () => {
      const templates = listTemplates(tmpDir);
      expect(templates).toEqual([]);
    });

    it("lists all available templates", () => {
      writeTemplate(tmpDir, "template-a", {
        name: "template-a",
        description: "Template A",
        tasks: [],
      }, "");
      writeTemplate(tmpDir, "template-b", {
        name: "template-b",
        description: "Template B",
        tasks: [],
      }, "");

      const templates = listTemplates(tmpDir);
      expect(templates).toHaveLength(2);
      expect(templates.map((t) => t.name).sort()).toEqual(["template-a", "template-b"]);
    });
  });

  describe("instantiateTemplate", () => {
    it("returns null for non-existent template", () => {
      const result = instantiateTemplate(tmpDir, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns goal and tasks from template", () => {
      writeTemplate(tmpDir, "test-fix", {
        name: "test-fix",
        description: "Run tests then fix",
        tasks: [
          { title: "Run tests", scope: ["**/*.test.*"], description: "Run suite." },
          { title: "Fix failures", scope: ["src/**"], blocked_by: [1], description: "Fix them." },
        ],
      }, "");

      const result = instantiateTemplate(tmpDir, "test-fix");
      expect(result).toBeTruthy();
      expect(result!.goal).toBe("Run tests then fix");
      expect(result!.tasks).toHaveLength(2);
      expect(result!.tasks[0].title).toBe("Run tests");
      expect(result!.tasks[1].blocked_by).toEqual([1]);
    });

    it("allows overriding the goal", () => {
      writeTemplate(tmpDir, "simple", {
        name: "simple",
        description: "Default goal",
        tasks: [{ title: "Do thing", scope: ["src/**"], description: "Do it." }],
      }, "");

      const result = instantiateTemplate(tmpDir, "simple", { goal: "Custom goal" });
      expect(result!.goal).toBe("Custom goal");
    });
  });
});
