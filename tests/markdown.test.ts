import { describe, expect, it } from "vitest";

import {
  collectHeadings,
  firstParagraph,
  parseInline,
  parseMarkdown,
  plainText,
  splitTableRow,
} from "@/lib/markdown";
import type { MarkdownBlock } from "@/lib/markdown";

function blockAt(blocks: readonly MarkdownBlock[], index: number): MarkdownBlock {
  const block = blocks[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  return block;
}

describe("splitTableRow", () => {
  it("splits on pipes and trims the outer ones", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
  });

  it("keeps a pipe that is inside a code span", () => {
    expect(splitTableRow("| `a | b` | c |")).toEqual(["`a | b`", "c"]);
  });

  it("unescapes an escaped pipe", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });
});

describe("parseInline", () => {
  it("returns plain text unchanged", () => {
    expect(parseInline("just words")).toEqual([{ kind: "text", value: "just words" }]);
  });

  it("recognises a code span before any other marker", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ kind: "code", value: "**not bold**" }]);
  });

  it("parses bold, italic and links", () => {
    const nodes = parseInline("**bold** and _italic_ and [link](/docs)");
    expect(nodes.map((node) => node.kind)).toEqual(["strong", "text", "emphasis", "text", "link"]);
  });

  it("does not treat an underscore inside an identifier as emphasis", () => {
    const nodes = parseInline("pick_commit and source_roi");
    expect(nodes).toEqual([{ kind: "text", value: "pick_commit and source_roi" }]);
  });

  it("turns a bare URL in angle brackets into a link", () => {
    const nodes = parseInline("<https://example.com/x>");
    expect(nodes).toEqual([
      {
        kind: "link",
        href: "https://example.com/x",
        children: [{ kind: "text", value: "https://example.com/x" }],
      },
    ]);
  });

  it("leaves an unclosed marker as text rather than swallowing the rest", () => {
    expect(plainText(parseInline("a ** b"))).toBe("a ** b");
  });
});

describe("parseMarkdown", () => {
  it("parses headings with stable, de-duplicated anchors", () => {
    const blocks = parseMarkdown("## Proof\n\n## Proof\n");
    expect(blockAt(blocks, 0)).toMatchObject({ kind: "heading", depth: 2, id: "proof" });
    expect(blockAt(blocks, 1)).toMatchObject({ kind: "heading", depth: 2, id: "proof-1" });
  });

  it("keeps fenced code verbatim, including blank lines and pipes", () => {
    const source = ["```ts", "const a = 1;", "", "const b = '|';", "```"].join("\n");
    const block = blockAt(parseMarkdown(source), 0);
    expect(block).toEqual({
      kind: "code",
      language: "ts",
      value: "const a = 1;\n\nconst b = '|';",
    });
  });

  it("does not parse markdown inside a fence", () => {
    const blocks = parseMarkdown("```txt\n## not a heading\n```\n");
    expect(blocks).toHaveLength(1);
    expect(blockAt(blocks, 0).kind).toBe("code");
  });

  it("joins wrapped paragraph lines into one paragraph", () => {
    const blocks = parseMarkdown("first line\nsecond line\n\nnext paragraph");
    expect(blocks).toHaveLength(2);
    const first = blockAt(blocks, 0);
    if (first.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(plainText(first.children)).toBe("first line second line");
  });

  it("parses an unordered list and folds indented continuations", () => {
    const blocks = parseMarkdown("- one\n  wrapped\n- two\n");
    const block = blockAt(blocks, 0);
    expect(block.kind).toBe("list");
    if (block.kind !== "list") throw new Error("expected a list");
    expect(block.ordered).toBe(false);
    expect(block.items.map(plainText)).toEqual(["one wrapped", "two"]);
  });

  it("parses an ordered list and keeps its start number", () => {
    const blocks = parseMarkdown("3. three\n4. four\n");
    const block = blockAt(blocks, 0);
    if (block.kind !== "list") throw new Error("expected a list");
    expect(block.ordered).toBe(true);
    expect(block.start).toBe(3);
    expect(block.items.map(plainText)).toEqual(["three", "four"]);
  });

  it("does not let an ordered marker inside a paragraph start a list", () => {
    const blocks = parseMarkdown("The steps are simple\n1. not a list\n");
    expect(blockAt(blocks, 0).kind).toBe("paragraph");
  });

  it("parses a table with alignment and inline cells", () => {
    const source = ["| Name | Score |", "| :--- | ---: |", "| `a` | **7** |"].join("\n");
    const block = blockAt(parseMarkdown(source), 0);
    if (block.kind !== "table") throw new Error("expected a table");
    expect(block.align).toEqual(["left", "right"]);
    expect(block.header.map(plainText)).toEqual(["Name", "Score"]);
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0]?.map(plainText)).toEqual(["a", "7"]);
  });

  it("does not treat a pipe line as a table without a separator row", () => {
    const blocks = parseMarkdown("| not a table |\nstill a paragraph\n");
    expect(blockAt(blocks, 0).kind).toBe("paragraph");
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdown("---\n")).toEqual([{ kind: "rule" }]);
  });

  it("ignores CRLF line endings", () => {
    const blocks = parseMarkdown("## Title\r\n\r\ntext\r\n");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
  });
});

describe("collectHeadings", () => {
  it("stops at the requested depth", () => {
    const blocks = parseMarkdown("## Two\n\n### Three\n");
    expect(collectHeadings(blocks, 2).map((heading) => heading.text)).toEqual(["Two"]);
    expect(collectHeadings(blocks, 3).map((heading) => heading.text)).toEqual(["Two", "Three"]);
  });
});

describe("firstParagraph", () => {
  it("skips the title and returns the opening prose", () => {
    const blocks = parseMarkdown("# Title\n\nOpening line.\n\nSecond paragraph.\n");
    expect(firstParagraph(blocks)).toBe("Opening line.");
  });

  it("returns an empty string when there is no paragraph", () => {
    expect(firstParagraph(parseMarkdown("# Title\n"))).toBe("");
  });
});
