import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import type { TeamDB } from "../db.js";
import { initBasePath } from "../../protocol/dirs.js";
import {
  initMissionDir,
  writeMissionFile,
  writeMemberFile,
} from "../../protocol/mission.js";
import { appendAuditEntry } from "../../protocol/audit.js";

export function registerTeamTools(
  server: McpServer,
  db: TeamDB,
  basePath: string
): void {
  server.tool(
    "create_team",
    "Create a new mission and register caller as lead",
    {
      goal: z.string(),
      config: z.record(z.string(), z.unknown()).optional(),
      repo: z.string().optional(),
    },
    async ({ goal, config, repo }) => {
      try {
        const mission = db.createMission("lead");

        // Write filesystem representation
        initBasePath(basePath);
        const missionPath = join(basePath, "missions", mission.id);
        initMissionDir(missionPath);
        writeMissionFile(
          missionPath,
          {
            id: mission.id,
            status: "active",
            repo: repo ?? null,
            config: config ?? null,
            created_at: mission.created_at,
          },
          goal
        );
        writeMemberFile(missionPath, {
          agent_id: "lead",
          team_id: mission.id,
          role: "lead",
          status: "active",
          registered_at: mission.created_at,
        });
        appendAuditEntry(missionPath, { ts: Date.now(), agent: "lead", action: "mission_create", detail: goal });

        return {
          content: [
            { type: "text", text: JSON.stringify({ ...mission, goal }) },
          ],
        };
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
