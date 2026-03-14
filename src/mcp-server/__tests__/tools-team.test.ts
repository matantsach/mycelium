import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "../server.js";
import { parseFrontmatter } from "../../protocol/frontmatter.js";

describe("team tools", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => void;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mycelium-test-"));
    const { server, db } = createServer(tmpDir);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    cleanup = () => db.close();
  });

  afterEach(() => {
    cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create_team returns mission with ID", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Test mission" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.id).toBeTruthy();
    expect(data.status).toBe("active");
    expect(data.goal).toBe("Test mission");
  });

  it("create_team writes mission directory", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "FS test" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const missionPath = join(tmpDir, "missions", data.id);

    expect(existsSync(join(missionPath, "mission.md"))).toBe(true);
    expect(existsSync(join(missionPath, "tasks"))).toBe(true);
    expect(existsSync(join(missionPath, "members", "lead.md"))).toBe(true);

    const mission = parseFrontmatter(
      readFileSync(join(missionPath, "mission.md"), "utf-8")
    );
    expect(mission.data.id).toBe(data.id);
    expect(mission.body).toContain("FS test");
  });

  it("create_team includes repo when provided", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Repo test", repo: "https://github.com/example/repo" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.id).toBeTruthy();

    const missionPath = join(tmpDir, "missions", data.id);
    const mission = parseFrontmatter(
      readFileSync(join(missionPath, "mission.md"), "utf-8")
    );
    expect(mission.data.repo).toBe("https://github.com/example/repo");
  });

  it("create_team lead_agent_id is 'lead'", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Lead check" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.lead_agent_id).toBe("lead");
  });

  it("create_team writes lead member file", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Member file test" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const missionPath = join(tmpDir, "missions", data.id);

    const leadFile = parseFrontmatter(
      readFileSync(join(missionPath, "members", "lead.md"), "utf-8")
    );
    expect(leadFile.data.agent_id).toBe("lead");
    expect(leadFile.data.role).toBe("lead");
    expect(leadFile.data.status).toBe("active");
  });

  it("create_team appends audit entry", async () => {
    const result = await client.callTool({
      name: "create_team",
      arguments: { goal: "Audit test mission" },
    });
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    const missionPath = join(tmpDir, "missions", data.id);
    const auditPath = join(missionPath, "audit.jsonl");

    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    const entries = lines.map((l: string) => JSON.parse(l));
    const createEntry = entries.find((e: { action: string }) => e.action === "mission_create");
    expect(createEntry).toBeTruthy();
    expect(createEntry.agent).toBe("lead");
    expect(createEntry.detail).toBe("Audit test mission");
  });
});
