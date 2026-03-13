import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const basePath =
  process.env.MYCELIUM_BASE_PATH || join(homedir(), ".mycelium");
mkdirSync(basePath, { recursive: true });

const { server, db } = createServer(basePath);

function shutdown(): void {
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  try {
    db.close();
  } catch {
    // ignore
  }
});

const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => console.error("mycelium MCP server running"));
