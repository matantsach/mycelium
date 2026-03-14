import { appendFileSync } from "fs";
import { join } from "path";

export interface AuditEntry {
  ts: number;
  agent: string;
  action: string;
  task_id?: number;
  detail?: string;
}

export function appendAuditEntry(
  missionPath: string,
  entry: AuditEntry
): void {
  const clean: Record<string, unknown> = { ts: entry.ts, agent: entry.agent, action: entry.action };
  if (entry.task_id !== undefined) clean.task_id = entry.task_id;
  if (entry.detail !== undefined) clean.detail = entry.detail;
  appendFileSync(
    join(missionPath, "audit.jsonl"),
    JSON.stringify(clean) + "\n"
  );
}
