import { parseDocument } from "yaml";
import { z } from "zod";

const nonempty = z.string().trim().min(1);
export const noteMetadataFields = {
  id: nonempty,
  date: z.iso.date(),
  tags: z.array(nonempty).min(1),
  length_exception_reason: nonempty.optional(),
};

type Frontmatter =
  | { ok: false; message: string }
  | { ok: true; data: unknown; lines: string[]; bodyStart: number };

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 2) {
    return { ok: false, message: "Start the note with a delimited YAML frontmatter block." };
  }

  const yaml = lines.slice(1, end).join("\n");
  if (yaml.length > 8_192) {
    return { ok: false, message: "Keep YAML frontmatter at or below 8,192 characters." };
  }
  try {
    const document = parseDocument(yaml, { strict: true, uniqueKeys: true });
    if (document.errors.length || document.warnings.length) {
      return { ok: false, message: "Use valid YAML with unique keys and supported scalar types." };
    }
    return { ok: true, data: document.toJS({ maxAliasCount: 0 }), lines, bodyStart: end + 1 };
  } catch {
    return { ok: false, message: "Could not parse the YAML frontmatter. YAML aliases are unsupported." };
  }
}
