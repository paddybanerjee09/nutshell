import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Plugin } from "unified";

const wikiPrefix = "#nutshell-note=";
const wikiPattern = /\[\[([^\r\n|\]]{1,512})(?:\|([^\r\n\]]{1,256}))?\]\]/gu;

export function wikiLinkHref(target: string) {
  return wikiPrefix + (target.isWellFormed() ? encodeURIComponent(target) : "");
}

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  identifier?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function splitWikiText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(wikiPattern)) {
    const target = match[1]!.trim();
    if (!target) continue;
    if (match.index > offset) nodes.push({ type: "text", value: value.slice(offset, match.index) });
    nodes.push({ type: "link", url: wikiLinkHref(target),
      children: [{ type: "text", value: match[2]?.trim() || target }] });
    offset = match.index + match[0].length;
  }
  if (offset < value.length) nodes.push({ type: "text", value: value.slice(offset) });
  return nodes;
}

export const remarkWorkspaceWikilinks: Plugin = () => (tree, file) => {
  const source = String(file);
  const pending: MarkdownNode[] = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    if (!node.children || node.type === "link" || node.type === "linkReference") continue;
    node.children = node.children.flatMap((child) => {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type !== "text" || !child.value || start === undefined || end === undefined ||
          source.slice(start, end) !== child.value) return [child];
      return splitWikiText(child.value);
    });
    for (const child of node.children) pending.push(child);
  }
};

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkWorkspaceWikilinks);

export function markdownLinks(markdown: string): string[] {
  const root: MarkdownNode = markdownParser.runSync(markdownParser.parse(markdown), markdown);
  const links: string[] = [];
  const definitions = new Map<string, string>();
  const references: string[] = [];
  const pending = [root];
  while (pending.length) {
    const { type, children, url, identifier } = pending.pop()!;
    if (type === "link" && url) links.push(url);
    if (type === "definition" && identifier && url && !definitions.has(identifier)) definitions.set(identifier, url);
    if (type === "linkReference" && identifier) references.push(identifier);
    for (let i = (children?.length ?? 0) - 1; i >= 0; i--) pending.push(children![i]!);
  }
  for (const identifier of references) {
    const target = definitions.get(identifier);
    if (target) links.push(target);
  }
  return links;
}

function resolvePath(path: string, base: string) {
  const parts = base ? base.split("/") : [];
  for (const name of path.split("/")) {
    if (!name || name === ".") continue;
    if (name === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(name);
    }
  }
  return parts.join("/");
}

export function documentResolver(documents: readonly { id: string; path: string }[]) {
  const paths = new Map(documents.map(({ path, id }) => [path, id]));
  const basenames = new Map<string, string | null>();
  for (const { path, id } of documents) {
    const filename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/iu, "").toLowerCase();
    basenames.set(filename, basenames.has(filename) ? null : id);
  }

  return (source: string, href: string) => {
    const wiki = href.startsWith(wikiPrefix);
    let raw: string;
    try {
      raw = decodeURIComponent(wiki ? href.slice(wikiPrefix.length) : (href.split(/[?#]/u, 1)[0] ?? ""));
    } catch {
      return null;
    }
    const target = (wiki ? raw.split("#", 1)[0] : raw)?.trim();
    if (!target || /[\\:\p{Cc}]|^\/\//u.test(target)) return null;
    const file = wiki && !/\.md$/iu.test(target) ? target + ".md" : target;
    const rooted = file.startsWith("/") || file.startsWith("nutshell-vault/");
    const base = rooted ? "" : source.slice(0, source.lastIndexOf("/"));
    const resolved = resolvePath(file, base);
    if (resolved && paths.has(resolved)) return paths.get(resolved)!;
    return wiki && !target.includes("/") ? basenames.get(target.replace(/\.md$/iu, "").toLowerCase()) ?? null : null;
  };
}
