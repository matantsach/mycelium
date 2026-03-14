import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";
import { findTaskFile, updateTaskFileFrontmatter } from "../../protocol/mission.js";
import { appendAuditEntry } from "../../protocol/audit.js";
import { writeMessage } from "../../protocol/inbox.js";

export function registerTaskTools(server: McpServer, db: TeamDB, basePath: string): void {
  server.tool(
    "claim_task",
    "Atomically claim a pending task",
    { mission_id: z.string(), task_id: z.number(), agent_id: agentIdSchema },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        db.getActiveMission(mission_id);
        const task = db.claimTask(mission_id, task_id, agent_id);
        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, {
              status: "in_progress", assigned_to: agent_id, claimed_at: task.claimed_at,
            });
          }
          appendAuditEntry(missionPath, { ts: Date.now(), agent: agent_id, action: "task_claim", task_id });
        } catch { /* Filesystem write failure is non-fatal */ }
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "complete_task",
    "Mark an in-progress task as completed or needs_review",
    { mission_id: z.string(), task_id: z.number(), agent_id: agentIdSchema, result: z.string(), review_required: z.boolean().optional() },
    async ({ mission_id, task_id, agent_id, result: resultText, review_required }) => {
      try {
        const task = db.completeTask(mission_id, task_id, agent_id, review_required);
        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, { status: task.status, completed_at: task.completed_at });
          }
          appendAuditEntry(missionPath, { ts: Date.now(), agent: agent_id, action: "task_complete", task_id, detail: resultText });
        } catch { /* Non-fatal */ }
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "approve_task",
    "Lead-only: approve a task in needs_review",
    { mission_id: z.string(), task_id: z.number(), agent_id: agentIdSchema },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        const task = db.approveTask(mission_id, task_id, agent_id);
        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, { status: "completed", completed_at: task.completed_at });
          }
          appendAuditEntry(missionPath, { ts: Date.now(), agent: agent_id, action: "task_approve", task_id });
        } catch { /* Non-fatal */ }
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );

  server.tool(
    "reject_task",
    "Lead-only: reject a task and send feedback",
    { mission_id: z.string(), task_id: z.number(), agent_id: agentIdSchema, feedback: z.string() },
    async ({ mission_id, task_id, agent_id, feedback }) => {
      try {
        const task = db.rejectTask(mission_id, task_id, agent_id, feedback);
        const missionPath = join(basePath, "missions", mission_id);
        try {
          const filePath = findTaskFile(missionPath, task_id);
          if (filePath) {
            updateTaskFileFrontmatter(filePath, { status: "in_progress", completed_at: null });
          }
          appendAuditEntry(missionPath, { ts: Date.now(), agent: agent_id, action: "task_reject", task_id, detail: feedback });
          if (task.assigned_to) {
            writeMessage(missionPath, task.assigned_to, agent_id, feedback);
          }
        } catch { /* Non-fatal */ }
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );
}
