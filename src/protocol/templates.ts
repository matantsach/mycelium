import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { FrontmatterResult } from "./frontmatter.js";

export interface TemplateSummary {
  name: string;
  description: string;
}

export interface TemplateTask {
  title: string;
  scope: string[];
  description: string;
  blocked_by?: number[];
}

export function writeTemplate(
  basePath: string,
  name: string,
  data: Record<string, unknown>,
  body: string
): void {
  const filePath = join(basePath, "templates", `${name}.md`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringifyFrontmatter(data, body), "utf-8");
}

export function readTemplate(
  basePath: string,
  name: string
): FrontmatterResult | null {
  const filePath = join(basePath, "templates", `${name}.md`);
  if (!existsSync(filePath)) return null;
  return parseFrontmatter(readFileSync(filePath, "utf-8"));
}

export function listTemplates(basePath: string): TemplateSummary[] {
  const templatesDir = join(basePath, "templates");
  if (!existsSync(templatesDir)) return [];

  const files = readdirSync(templatesDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = readFileSync(join(templatesDir, file), "utf-8");
    const { data } = parseFrontmatter(content);
    return {
      name: (data.name as string) ?? file.replace(/\.md$/, ""),
      description: (data.description as string) ?? "",
    };
  });
}

export function instantiateTemplate(
  basePath: string,
  templateName: string,
  overrides?: { goal?: string }
): { goal: string; tasks: TemplateTask[] } | null {
  const template = readTemplate(basePath, templateName);
  if (!template) return null;

  const tasks = (template.data.tasks as TemplateTask[]) ?? [];
  const goal = overrides?.goal
    ?? (template.data.description as string)
    ?? templateName;

  return { goal, tasks };
}
