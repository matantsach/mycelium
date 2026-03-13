import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";

describe("task tools", () => {
  let tmpDir: string;
  let client: Client;
  let db: TeamDB;
  let missionId: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-tasks-test-"));
    const result = createServer(tmpDir);
    db = result.db;
    const { server } = result;

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    // Create a mission via DB directly (faster, avoids FS overhead)
    const mission = db.createMission("lead");
    missionId = mission.id;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("claim_task", () => {
    it("claims a pending task and returns in_progress", async () => {
      db.insertTask(missionId, 1, []);

      const result = await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
      });
      const task = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text
      );
      expect(task.status).toBe("in_progress");
      expect(task.assigned_to).toBe("arm-1");
      expect(task.claimed_at).toBeTruthy();
    });

    it("returns error when task does not exist", async () => {
      const result = await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 99, agent_id: "arm-1" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("not found");
    });

    it("returns error on double-claim", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");

      const result = await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-2" },
      });
      expect(result.isError).toBe(true);
    });

    it("returns error when task is blocked", async () => {
      db.insertTask(missionId, 1, []);
      db.insertTask(missionId, 2, [1]); // blocked by task 1

      const result = await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 2, agent_id: "arm-1" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("blocked");
    });

    it("returns error for invalid mission", async () => {
      const result = await client.callTool({
        name: "claim_task",
        arguments: {
          mission_id: "nonexistent",
          task_id: 1,
          agent_id: "arm-1",
        },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("not found");
    });
  });

  describe("complete_task", () => {
    it("completes an in_progress task", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");

      const result = await client.callTool({
        name: "complete_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-1",
          result: "Done!",
        },
      });
      const task = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text
      );
      expect(task.status).toBe("completed");
      expect(task.completed_at).toBeTruthy();
    });

    it("transitions to needs_review when review_required=true", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");

      const result = await client.callTool({
        name: "complete_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-1",
          result: "Please review",
          review_required: true,
        },
      });
      const task = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text
      );
      expect(task.status).toBe("needs_review");
    });

    it("returns error if agent_id mismatch", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");

      const result = await client.callTool({
        name: "complete_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-2",
          result: "Sneaky",
        },
      });
      expect(result.isError).toBe(true);
    });

    it("auto-unblocks dependent tasks on completion", async () => {
      db.insertTask(missionId, 1, []);
      db.insertTask(missionId, 2, [1]);
      db.claimTask(missionId, 1, "arm-1");

      await client.callTool({
        name: "complete_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-1",
          result: "Done",
        },
      });

      const task2 = db.getTask(missionId, 2);
      expect(task2!.status).toBe("pending"); // auto-unblocked
    });
  });

  describe("approve_task", () => {
    it("approves a needs_review task", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);

      const result = await client.callTool({
        name: "approve_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "lead" },
      });
      const task = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text
      );
      expect(task.status).toBe("completed");
    });

    it("returns error for non-lead agent", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);

      const result = await client.callTool({
        name: "approve_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-2" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("lead");
    });

    it("returns error if task is not in needs_review", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      // task is in_progress, not needs_review

      const result = await client.callTool({
        name: "approve_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "lead" },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("reject_task", () => {
    it("rejects a needs_review task back to in_progress", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);

      const result = await client.callTool({
        name: "reject_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "lead",
          feedback: "Needs more tests",
        },
      });
      const task = JSON.parse(
        (result.content as Array<{ text: string }>)[0].text
      );
      expect(task.status).toBe("in_progress");
    });

    it("returns error for non-lead agent", async () => {
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);

      const result = await client.callTool({
        name: "reject_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-2",
          feedback: "Nice try",
        },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("lead");
    });

    it("returns error if task is not in needs_review", async () => {
      db.insertTask(missionId, 1, []);
      // task is still pending

      const result = await client.callTool({
        name: "reject_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "lead",
          feedback: "Cannot reject pending task",
        },
      });
      expect(result.isError).toBe(true);
    });
  });
});
