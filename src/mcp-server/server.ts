import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTaskTools } from "./tools/tasks.js";

export function createServer(
  basePath: string
): { server: McpServer; db: TeamDB } {
  const server = new McpServer({ name: "mycelium", version: "0.5.0" });
  const db = new TeamDB(join(basePath, "teams.db"));
  registerTeamTools(server, db, basePath);
  registerTaskTools(server, db, basePath);
  return { server, db };
}
