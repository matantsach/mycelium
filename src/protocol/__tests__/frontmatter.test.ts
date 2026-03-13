import { describe, it, expect } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses markdown with YAML frontmatter", () => {
    const input = `---
id: mission-001
status: active
created_at: 1741000000
---

# My Mission

Some body content.`;

    const result = parseFrontmatter(input);
    expect(result.data).toEqual({
      id: "mission-001",
      status: "active",
      created_at: 1741000000,
    });
    expect(result.body).toBe("# My Mission\n\nSome body content.");
  });

  it("parses nested objects in frontmatter", () => {
    const input = `---
id: mission-001
config:
  review_required: true
  max_arms: 4
  budget: 80
---

Body.`;

    const result = parseFrontmatter(input);
    expect(result.data.config).toEqual({
      review_required: true,
      max_arms: 4,
      budget: 80,
    });
  });

  it("parses arrays in frontmatter", () => {
    const input = `---
blocked_by:
  - 1
  - 2
scope:
  - src/routes/**
  - tests/**
---

Body.`;

    const result = parseFrontmatter(input);
    expect(result.data.blocked_by).toEqual([1, 2]);
    expect(result.data.scope).toEqual(["src/routes/**", "tests/**"]);
  });

  it("returns empty data for content without frontmatter", () => {
    const result = parseFrontmatter("Just plain text.");
    expect(result.data).toEqual({});
    expect(result.body).toBe("Just plain text.");
  });

  it("handles empty body", () => {
    const input = `---
id: test
---`;

    const result = parseFrontmatter(input);
    expect(result.data).toEqual({ id: "test" });
    expect(result.body).toBe("");
  });
});

describe("stringifyFrontmatter", () => {
  it("creates markdown with YAML frontmatter", () => {
    const result = stringifyFrontmatter(
      { id: "mission-001", status: "active" },
      "# My Mission\n\nBody."
    );
    const parsed = parseFrontmatter(result);
    expect(parsed.data).toEqual({ id: "mission-001", status: "active" });
    expect(parsed.body).toBe("# My Mission\n\nBody.");
  });

  it("round-trips nested objects", () => {
    const data = {
      id: "m1",
      config: { review_required: true, max_arms: 4 },
    };
    const body = "Content.";
    const result = parseFrontmatter(stringifyFrontmatter(data, body));
    expect(result.data).toEqual(data);
    expect(result.body).toBe(body);
  });
});
