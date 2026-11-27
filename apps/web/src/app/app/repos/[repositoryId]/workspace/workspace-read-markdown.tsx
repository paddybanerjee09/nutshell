"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkWorkspaceWikilinks } from "./workspace-markdown";

export function WorkspaceReadMarkdown({ markdown, resolve, onOpen, unavailable = "Link target unavailable in this snapshot" }: {
  markdown: string;
  resolve: (href: string) => string | null;
  onOpen: (id: string) => void;
  unavailable?: string;
}) {
  return <Markdown skipHtml remarkPlugins={[remarkGfm, remarkWorkspaceWikilinks]} components={{
    a: ({ href, children }) => {
      const target = href && resolve(href);
      if (target) return <button type="button" className="workspace-wikilink" onClick={() => onOpen(target)}>{children}</button>;
      if (href && /^(?:https?:\/\/|mailto:)/iu.test(href)) return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
      return <span title={unavailable}>{children}</span>;
    },
    img: ({ alt }) => <span>{alt ? `Image unavailable. ${alt}` : "Image unavailable."}</span>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label="Checklist item" />,
  }}>{markdown}</Markdown>;
}
