/**
 * A deliberately small Markdown parser for the documents in `docs/`.
 *
 * The repository ships four hand-written Markdown files and no Markdown dependency: adding
 * `react-markdown` plus a plugin chain would pull a large tree into the bundle to render
 * content this project already controls. This parser therefore supports exactly the subset
 * those files use — headings, paragraphs, fenced code, tables, lists, rules, and the inline
 * forms (code, bold, italic, links, autolinks) — and renders anything else as plain text
 * rather than guessing.
 *
 * It is a pure function pair, so it is unit-tested like the rest of `lib/`.
 */

export type InlineNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "emphasis"; readonly children: readonly InlineNode[] }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly InlineNode[] };

export type HeadingDepth = 1 | 2 | 3 | 4;

export type TableAlignment = "left" | "center" | "right";

export type MarkdownBlock =
  | {
      readonly kind: "heading";
      readonly depth: HeadingDepth;
      readonly id: string;
      readonly children: readonly InlineNode[];
    }
  | { readonly kind: "paragraph"; readonly children: readonly InlineNode[] }
  | { readonly kind: "code"; readonly language: string | null; readonly value: string }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly items: ReadonlyArray<readonly InlineNode[]>;
    }
  | {
      readonly kind: "table";
      readonly align: readonly TableAlignment[];
      readonly header: ReadonlyArray<readonly InlineNode[]>;
      readonly rows: ReadonlyArray<ReadonlyArray<readonly InlineNode[]>>;
    }
  | { readonly kind: "rule" };

const FENCE = /^```(\S*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const RULE = /^(?:---+|\*\*\*+|___+)$/;
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
const ORDERED_ITEM = /^(\d{1,9})\.\s+(.*)$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?$/;

/** Words that must not be turned into anchors twice when two headings share a title. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Splits a table row on unescaped pipes that are not inside a code span, so a cell such as
 * `` `a | b` `` survives intact.
 */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let inCode = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (character === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "`") {
      inCode = !inCode;
      current += character;
      continue;
    }
    if (character === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function parseAlignment(separator: string): TableAlignment[] {
  return splitTableRow(separator).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function isBoundary(source: string, index: number): boolean {
  if (index === 0) return true;
  const previous = source[index - 1];
  return previous === undefined || !/[A-Za-z0-9]/.test(previous);
}

/**
 * Parses the inline subset. Emphasis markers are only recognised at a word boundary, so
 * identifiers such as `pick_commit` are never mistaken for italics.
 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    nodes.push({ kind: "text", value: buffer });
    buffer = "";
  };

  while (index < source.length) {
    const character = source[index];

    if (character === "`") {
      const end = source.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ kind: "code", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (character === "*" && source.startsWith("**", index) && isBoundary(source, index)) {
      const end = source.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        nodes.push({ kind: "strong", children: parseInline(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    if (character === "_" && isBoundary(source, index) && source[index + 1] !== " ") {
      const end = source.indexOf("_", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ kind: "emphasis", children: parseInline(source.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      if (labelEnd > index) {
        const hrefEnd = source.indexOf(")", labelEnd + 2);
        if (hrefEnd > labelEnd + 2) {
          flush();
          nodes.push({
            kind: "link",
            href: source.slice(labelEnd + 2, hrefEnd),
            children: parseInline(source.slice(index + 1, labelEnd)),
          });
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    if (character === "<") {
      const end = source.indexOf(">", index + 1);
      if (end > index + 1) {
        const target = source.slice(index + 1, end);
        if (/^https?:\/\/\S+$/.test(target)) {
          flush();
          nodes.push({ kind: "link", href: target, children: [{ kind: "text", value: target }] });
          index = end + 1;
          continue;
        }
      }
    }

    buffer += character;
    index += 1;
  }

  flush();
  return nodes;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const seenIds = new Map<string, number>();

  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] === undefined || fence[1] === "" ? null : fence[1];
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", language, value: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const hashes = heading[1] ?? "#";
      const text = heading[2] ?? "";
      const children = parseInline(text);
      const base = slugify(plainText(children));
      const previous = seenIds.get(base) ?? 0;
      seenIds.set(base, previous + 1);
      blocks.push({
        kind: "heading",
        depth: Math.min(hashes.length, 4) as HeadingDepth,
        id: previous === 0 ? base : `${base}-${previous}`,
        children,
      });
      index += 1;
      continue;
    }

    if (RULE.test(line.trim())) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      const separator = lines[index + 1];
      if (separator !== undefined && TABLE_SEPARATOR.test(separator.trim())) {
        flushParagraph();
        const header = splitTableRow(line).map(parseInline);
        const align = parseAlignment(separator.trim());
        const rows: InlineNode[][][] = [];
        index += 2;
        while (index < lines.length && (lines[index] ?? "").trimStart().startsWith("|")) {
          rows.push(splitTableRow(lines[index] ?? "").map(parseInline));
          index += 1;
        }
        blocks.push({ kind: "table", align, header, rows });
        continue;
      }
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = ORDERED_ITEM.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const start = ordered === null ? 1 : Number(ordered[1]);
      const raw: string[] = [];

      while (index < lines.length) {
        const candidate = lines[index] ?? "";
        const nextUnordered = UNORDERED_ITEM.exec(candidate);
        const nextOrdered = ORDERED_ITEM.exec(candidate);

        if (isOrdered && nextOrdered) {
          raw.push((nextOrdered[2] ?? "").trim());
          index += 1;
          continue;
        }
        if (!isOrdered && nextUnordered) {
          raw.push((nextUnordered[1] ?? "").trim());
          index += 1;
          continue;
        }
        // An indented continuation line belongs to the item above it; it is joined before
        // parsing so inline formatting that spans the wrap still resolves.
        if (raw.length > 0 && /^\s+\S/.test(candidate)) {
          raw[raw.length - 1] = `${raw[raw.length - 1]} ${candidate.trim()}`;
          index += 1;
          continue;
        }
        break;
      }

      blocks.push({ kind: "list", ordered: isOrdered, start, items: raw.map(parseInline) });
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  return blocks;
}

/** Flattens inline nodes to their text, used for slugs and for merging wrapped list lines. */
export function plainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.value;
        case "strong":
        case "emphasis":
        case "link":
          return plainText(node.children);
      }
    })
    .join("");
}

export interface MarkdownHeading {
  readonly depth: HeadingDepth;
  readonly id: string;
  readonly text: string;
}

/** Collects `##`/`###` headings so a document page can render its own table of contents. */
export function collectHeadings(
  blocks: readonly MarkdownBlock[],
  maxDepth: HeadingDepth = 2,
): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  for (const block of blocks) {
    if (block.kind !== "heading") continue;
    if (block.depth > maxDepth) continue;
    headings.push({ depth: block.depth, id: block.id, text: plainText(block.children) });
  }
  return headings;
}

/** First paragraph of a document, used as its summary on the docs index. */
export function firstParagraph(blocks: readonly MarkdownBlock[]): string {
  for (const block of blocks) {
    if (block.kind === "paragraph") return plainText(block.children);
  }
  return "";
}
