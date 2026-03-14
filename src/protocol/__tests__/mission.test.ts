import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  initMissionDir,
  writeMissionFile,
  readMissionFile,
  writeTaskFile,
  readTaskFile,
  writeMemberFile,
  listMissions,
  findTaskFile,
  updateTaskFileFrontmatter,
} from "../mission.js";

describe("mission files", () => {
  let tmpBase: string;
  let missionPath: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    missionPath = join(tmpBase, "missions", "test-mission");
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  describe("initMissionDir", () => {
    it("creates all mission subdirectories", () => {
      initMissionDir(missionPath);
      for (const sub of [
        "tasks",
        "members",
        "inbox",
        "progress",
        "knowledge",
      ]) {
        expect(existsSync(join(missionPath, sub))).toBe(true);
      }
    });
  });

  describe("writeMissionFile / readMissionFile", () => {
    it("writes and reads mission.md with frontmatter", () => {
      initMissionDir(missionPath);
      writeMissionFile(missionPath, {
        id: "test-mission",
        status: "active",
        repo: "/path/to/repo",
        config: {
          review_required: true,
          max_arms: 4,
          budget: 80,
          runtime: "copilot-cli",
        },
        created_at: 1741000000,
      }, "Implement payment processing");

      const mission = readMissionFile(missionPath);
      expect(mission.data.id).toBe("test-mission");
      expect(mission.data.status).toBe("active");
      expect(mission.data.repo).toBe("/path/to/repo");
      expect(
        (mission.data.config as Record<string, unknown>).max_arms
      ).toBe(4);
      expect(mission.body).toContain("Implement payment processing");
    });
  });

  describe("writeTaskFile / readTaskFile", () => {
    it("writes and reads a task file with proper naming", () => {
      initMissionDir(missionPath);
      const taskData = {
        id: 1,
        status: "pending" as const,
        assigned_to: null,
        blocked_by: [],
        scope: ["src/routes/payments.ts", "tests/payments/**"],
        prior_tasks: [],
        created_at: 1741000000,
      };
      writeTaskFile(
        missionPath,
        taskData,
        "Add payment routing",
        "Implement /payments route."
      );

      const filePath = join(
        missionPath,
        "tasks",
        "001-add-payment-routing.md"
      );
      expect(existsSync(filePath)).toBe(true);

      const task = readTaskFile(filePath);
      expect(task.data.id).toBe(1);
      expect(task.data.status).toBe("pending");
      expect(task.data.scope).toEqual([
        "src/routes/payments.ts",
        "tests/payments/**",
      ]);
      expect(task.body).toContain("Add payment routing");
      expect(task.body).toContain("Implement /payments route.");
    });
  });

  describe("writeMemberFile", () => {
    it("writes member file to members/ directory", () => {
      initMissionDir(missionPath);
      writeMemberFile(missionPath, {
        agent_id: "arm-1",
        team_id: "test-mission",
        role: "teammate",
        status: "active",
        runtime: "copilot-cli",
        worktree: "/path/to/worktree",
        registered_at: 1741000002,
      });

      const filePath = join(missionPath, "members", "arm-1.md");
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("agent_id: arm-1");
      expect(content).toContain("role: teammate");
    });
  });

  describe("listMissions", () => {
    it("lists all missions with parsed frontmatter", () => {
      mkdirSync(join(tmpBase, "missions"), { recursive: true });
      const m1 = join(tmpBase, "missions", "m1");
      const m2 = join(tmpBase, "missions", "m2");
      initMissionDir(m1);
      initMissionDir(m2);
      writeMissionFile(m1, {
        id: "m1",
        status: "active",
        created_at: 1741000000,
      }, "Mission 1");
      writeMissionFile(m2, {
        id: "m2",
        status: "completed",
        created_at: 1741000001,
      }, "Mission 2");

      const missions = listMissions(tmpBase);
      expect(missions).toHaveLength(2);
      expect(missions.map((m) => m.data.id).sort()).toEqual(["m1", "m2"]);
    });

    it("returns empty array when no missions exist", () => {
      mkdirSync(join(tmpBase, "missions"), { recursive: true });
      expect(listMissions(tmpBase)).toEqual([]);
    });
  });

  describe("findTaskFile", () => {
    it("finds task file by ID with zero-padded prefix", () => {
      initMissionDir(missionPath);
      writeTaskFile(
        missionPath,
        { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: Date.now(), claimed_at: null, completed_at: null },
        "Test task",
        "Do the thing"
      );

      const found = findTaskFile(missionPath, 1);
      expect(found).toBeDefined();
      expect(found!).toContain("001-test-task.md");
    });

    it("returns undefined for non-existent task", () => {
      initMissionDir(missionPath);
      const found = findTaskFile(missionPath, 99);
      expect(found).toBeUndefined();
    });
  });

  describe("updateTaskFileFrontmatter", () => {
    it("merges updates into existing frontmatter", () => {
      initMissionDir(missionPath);
      writeTaskFile(
        missionPath,
        { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: 1000, claimed_at: null, completed_at: null },
        "Update test",
        "Some description"
      );

      const filePath = findTaskFile(missionPath, 1)!;
      updateTaskFileFrontmatter(filePath, { status: "in_progress", assigned_to: "arm-1", claimed_at: 2000 });

      const updated = readTaskFile(filePath);
      expect(updated.data.status).toBe("in_progress");
      expect(updated.data.assigned_to).toBe("arm-1");
      expect(updated.data.claimed_at).toBe(2000);
      expect(updated.data.id).toBe(1);
      expect(updated.data.created_at).toBe(1000);
    });

    it("preserves body content when updating frontmatter", () => {
      initMissionDir(missionPath);
      writeTaskFile(
        missionPath,
        { id: 1, status: "pending", assigned_to: null, blocked_by: [], prior_tasks: [], scope: [], created_at: 1000, claimed_at: null, completed_at: null },
        "Body test",
        "Important description"
      );

      const filePath = findTaskFile(missionPath, 1)!;
      updateTaskFileFrontmatter(filePath, { status: "completed" });

      const updated = readTaskFile(filePath);
      expect(updated.body).toContain("Body test");
      expect(updated.body).toContain("Important description");
    });
  });
});
