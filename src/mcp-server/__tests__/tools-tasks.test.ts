import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { parseFrontmatter } from "../../protocol/frontmatter.js";
import { writeTaskFile, findTaskFile } from "../../protocol/mission.js";

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
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    // Create mission via MCP (creates both DB + filesystem)
    const createResult = await client.callTool({ name: "create_team", arguments: { goal: "Test mission" } });
    const missionData = JSON.parse((createResult.content as Array<{ text: string }>)[0].text);
    missionId = missionData.id;
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

    it("updates task file frontmatter on claim", async () => {
      const missionPath = join(tmpDir, "missions", missionId);
      db.insertTask(missionId, 1, []);
      writeTaskFile(missionPath, { id: 1, status: "pending" }, "Task One", "Do the thing");

      await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
      });

      const filePath = findTaskFile(missionPath, 1);
      expect(filePath).toBeTruthy();
      const { data } = parseFrontmatter(readFileSync(filePath!, "utf-8"));
      expect(data.status).toBe("in_progress");
      expect(data.assigned_to).toBe("arm-1");
    });

    it("appends audit entry on claim", async () => {
      const missionPath = join(tmpDir, "missions", missionId);
      db.insertTask(missionId, 1, []);
      writeTaskFile(missionPath, { id: 1, status: "pending" }, "Task One", "Do the thing");

      await client.callTool({
        name: "claim_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "arm-1" },
      });

      const auditPath = join(missionPath, "audit.jsonl");
      expect(existsSync(auditPath)).toBe(true);
      const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
      const entries = lines.map((l) => JSON.parse(l));
      const claimEntry = entries.find((e) => e.action === "task_claim");
      expect(claimEntry).toBeTruthy();
      expect(claimEntry.agent).toBe("arm-1");
      expect(claimEntry.task_id).toBe(1);
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

    it("updates task file frontmatter and appends audit on complete", async () => {
      const missionPath = join(tmpDir, "missions", missionId);
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      writeTaskFile(missionPath, { id: 1, status: "in_progress" }, "Task One", "Do the thing");

      await client.callTool({
        name: "complete_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "arm-1",
          result: "All done",
        },
      });

      const filePath = findTaskFile(missionPath, 1);
      expect(filePath).toBeTruthy();
      const { data } = parseFrontmatter(readFileSync(filePath!, "utf-8"));
      expect(data.status).toBe("completed");

      const auditPath = join(missionPath, "audit.jsonl");
      const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
      const entries = lines.map((l) => JSON.parse(l));
      const completeEntry = entries.find((e) => e.action === "task_complete");
      expect(completeEntry).toBeTruthy();
      expect(completeEntry.agent).toBe("arm-1");
      expect(completeEntry.detail).toBe("All done");
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

    it("updates task file frontmatter and appends audit on approve", async () => {
      const missionPath = join(tmpDir, "missions", missionId);
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);
      writeTaskFile(missionPath, { id: 1, status: "needs_review" }, "Task One", "Do the thing");

      await client.callTool({
        name: "approve_task",
        arguments: { mission_id: missionId, task_id: 1, agent_id: "lead" },
      });

      const filePath = findTaskFile(missionPath, 1);
      expect(filePath).toBeTruthy();
      const { data } = parseFrontmatter(readFileSync(filePath!, "utf-8"));
      expect(data.status).toBe("completed");

      const auditPath = join(missionPath, "audit.jsonl");
      const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
      const entries = lines.map((l) => JSON.parse(l));
      const approveEntry = entries.find((e) => e.action === "task_approve");
      expect(approveEntry).toBeTruthy();
      expect(approveEntry.agent).toBe("lead");
      expect(approveEntry.task_id).toBe(1);
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

    it("updates task file frontmatter and appends audit on reject", async () => {
      const missionPath = join(tmpDir, "missions", missionId);
      db.insertTask(missionId, 1, []);
      db.claimTask(missionId, 1, "arm-1");
      db.completeTask(missionId, 1, "arm-1", true);
      writeTaskFile(missionPath, { id: 1, status: "needs_review" }, "Task One", "Do the thing");

      await client.callTool({
        name: "reject_task",
        arguments: {
          mission_id: missionId,
          task_id: 1,
          agent_id: "lead",
          feedback: "Not good enough",
        },
      });

      const filePath = findTaskFile(missionPath, 1);
      expect(filePath).toBeTruthy();
      const { data } = parseFrontmatter(readFileSync(filePath!, "utf-8"));
      expect(data.status).toBe("in_progress");

      const auditPath = join(missionPath, "audit.jsonl");
      const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
      const entries = lines.map((l) => JSON.parse(l));
      const rejectEntry = entries.find((e) => e.action === "task_reject");
      expect(rejectEntry).toBeTruthy();
      expect(rejectEntry.agent).toBe("lead");
      expect(rejectEntry.detail).toBe("Not good enough");
    });
  });
});
