import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { TeamDB } from "../db.js";

describe("TeamDB", () => {
  let tmpDir: string;
  let db: TeamDB;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-db-test-"));
    db = new TeamDB(join(tmpDir, "teams.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("missions", () => {
    it("creates a mission with generated ID", () => {
      const mission = db.createMission("lead");
      expect(mission.id).toBeTruthy();
      expect(mission.status).toBe("active");
      expect(mission.lead_agent_id).toBe("lead");
    });

    it("gets an active mission", () => {
      const created = db.createMission("lead");
      const fetched = db.getActiveMission(created.id);
      expect(fetched.id).toBe(created.id);
    });

    it("throws for non-existent mission", () => {
      expect(() => db.getActiveMission("nope")).toThrow("not found");
    });
  });

  describe("tasks", () => {
    it("inserts a task row", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      const task = db.getTask(m.id, 1);
      expect(task).toBeDefined();
      expect(task!.status).toBe("pending");
    });

    it("claims a pending task atomically", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      const task = db.claimTask(m.id, 1, "arm-1");
      expect(task.status).toBe("in_progress");
      expect(task.assigned_to).toBe("arm-1");
    });

    it("prevents double-claim", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      expect(() => db.claimTask(m.id, 1, "arm-2")).toThrow();
    });

    it("blocks claim when blockers are not completed", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.insertTask(m.id, 2, [1]);
      expect(() => db.claimTask(m.id, 2, "arm-1")).toThrow("blocked");
    });

    it("completes a task and triggers auto-unblock", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.insertTask(m.id, 2, [1]);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1");

      const t2 = db.getTask(m.id, 2);
      expect(t2!.status).toBe("pending"); // auto-unblocked
    });
  });

  describe("approvals", () => {
    it("approve_task transitions needs_review to completed", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true); // review_required
      const task = db.getTask(m.id, 1);
      expect(task!.status).toBe("needs_review");

      db.approveTask(m.id, 1, "lead");
      const approved = db.getTask(m.id, 1);
      expect(approved!.status).toBe("completed");
    });

    it("reject_task transitions needs_review to in_progress", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true);

      db.rejectTask(m.id, 1, "lead", "Needs more tests");
      const rejected = db.getTask(m.id, 1);
      expect(rejected!.status).toBe("in_progress");
    });

    it("enforces lead-only for approve", () => {
      const m = db.createMission("lead");
      db.insertTask(m.id, 1, []);
      db.claimTask(m.id, 1, "arm-1");
      db.completeTask(m.id, 1, "arm-1", true);

      expect(() => db.approveTask(m.id, 1, "arm-2")).toThrow("lead");
    });
  });
});
