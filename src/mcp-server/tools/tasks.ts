import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";

export function registerTaskTools(server: McpServer, db: TeamDB): void {
  server.tool(
    "claim_task",
    "Atomically claim a pending task",
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
    },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        db.getActiveMission(mission_id);
        const task = db.claimTask(mission_id, task_id, agent_id);
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
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
      result: z.string(),
      review_required: z.boolean().optional(),
    },
    async ({ mission_id, task_id, agent_id, review_required }) => {
      try {
        const task = db.completeTask(
          mission_id,
          task_id,
          agent_id,
          review_required
        );
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
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
    },
    async ({ mission_id, task_id, agent_id }) => {
      try {
        const task = db.approveTask(mission_id, task_id, agent_id);
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
    {
      mission_id: z.string(),
      task_id: z.number(),
      agent_id: agentIdSchema,
      feedback: z.string(),
    },
    async ({ mission_id, task_id, agent_id, feedback }) => {
      try {
        const task = db.rejectTask(mission_id, task_id, agent_id, feedback);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
  );
}
