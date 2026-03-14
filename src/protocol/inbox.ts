import {
  writeFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

export interface Message {
  filename: string;
  from: string;
  priority: boolean;
  timestamp: number;
  body: string;
}

export function writeMessage(
  missionPath: string,
  to: string,
  from: string,
  body: string,
  priority?: boolean,
  timestampOverride?: number
): string {
  const timestamp = timestampOverride ?? Date.now();
  const filename = `${timestamp}-${from}.md`;
  const content = stringifyFrontmatter(
    { from, priority: priority ?? false, timestamp },
    body
  );
  const inboxDir = join(missionPath, "inbox", to);
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, filename), content, "utf-8");
  return filename;
}

export function readMessages(
  missionPath: string,
  agentId: string
): Message[] {
  const inboxDir = join(missionPath, "inbox", agentId);
  if (!existsSync(inboxDir)) return [];

  const files = readdirSync(inboxDir).filter(
    (f) => f !== "_read" && f !== "_broadcast_cursor" && f.endsWith(".md")
  );

  return files
    .map((filename) => {
      const content = readFileSync(join(inboxDir, filename), "utf-8");
      const { data, body } = parseFrontmatter(content);
      return {
        filename,
        from: data.from as string,
        priority: (data.priority as boolean) ?? false,
        timestamp: data.timestamp as number,
        body,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function markRead(
  missionPath: string,
  agentId: string,
  filename: string
): void {
  const inboxDir = join(missionPath, "inbox", agentId);
  const readDir = join(inboxDir, "_read");
  mkdirSync(readDir, { recursive: true });
  renameSync(join(inboxDir, filename), join(readDir, filename));
}

export function writeBroadcast(
  missionPath: string,
  from: string,
  body: string,
  timestampOverride?: number
): string {
  const timestamp = timestampOverride ?? Date.now();
  const filename = `${timestamp}-${from}.md`;
  const content = stringifyFrontmatter(
    { from, priority: false, timestamp },
    body
  );
  writeFileSync(
    join(missionPath, "inbox", "_broadcast", filename),
    content,
    "utf-8"
  );
  return filename;
}

export function readBroadcasts(
  missionPath: string,
  agentId: string
): Message[] {
  const broadcastDir = join(missionPath, "inbox", "_broadcast");
  if (!existsSync(broadcastDir)) return [];

  // Read cursor
  const cursorPath = join(missionPath, "inbox", agentId, "_broadcast_cursor");
  let cursor = 0;
  if (existsSync(cursorPath)) {
    cursor = parseInt(readFileSync(cursorPath, "utf-8").trim(), 10) || 0;
  }

  const files = readdirSync(broadcastDir).filter((f) => f.endsWith(".md"));
  const messages: Message[] = [];

  for (const filename of files) {
    const content = readFileSync(join(broadcastDir, filename), "utf-8");
    const { data, body } = parseFrontmatter(content);
    const ts = data.timestamp as number;
    if (ts > cursor) {
      messages.push({
        filename,
        from: data.from as string,
        priority: (data.priority as boolean) ?? false,
        timestamp: ts,
        body,
      });
    }
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);

  // Update cursor
  if (messages.length > 0) {
    const maxTs = Math.max(...messages.map((m) => m.timestamp));
    const agentInboxDir = join(missionPath, "inbox", agentId);
    mkdirSync(agentInboxDir, { recursive: true });
    writeFileSync(cursorPath, String(maxTs), "utf-8");
  }

  return messages;
}
