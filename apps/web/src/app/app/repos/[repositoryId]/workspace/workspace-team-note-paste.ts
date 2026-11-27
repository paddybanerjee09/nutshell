import { isSafeTeamNoteLink } from "@nutshell/core/team-note-content";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";

function cleanLinks(content: Fragment): Fragment {
  const nodes: Node[] = [];
  content.forEach((node) => {
    const marks = node.marks.flatMap((mark) => {
      if (mark.type.name !== "link") return [mark];
      const href: unknown = mark.attrs.href;
      return typeof href === "string" && isSafeTeamNoteLink(href)
        ? [mark.type.create({ href, target: "_blank", rel: "noopener noreferrer", class: null, title: null })]
        : [];
    });
    const marked = node.mark(marks);
    nodes.push(marked.isLeaf ? marked : marked.copy(cleanLinks(marked.content)));
  });
  return Fragment.fromArray(nodes);
}

export function normalizePastedTeamNote(slice: Slice): Slice {
  return new Slice(cleanLinks(slice.content), slice.openStart, slice.openEnd);
}
