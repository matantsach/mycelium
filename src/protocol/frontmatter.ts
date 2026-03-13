import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: content };
  }
  const data = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  const body = match[2].trim();
  return { data, body };
}

export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string
): string {
  const yaml = stringifyYaml(data).trim();
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `---\n${yaml}\n---\n`;
  }
  return `---\n${yaml}\n---\n\n${trimmedBody}\n`;
}
