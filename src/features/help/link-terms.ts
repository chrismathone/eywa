import { HELP_TERMS } from "./terms";
import type { HelpToken } from "./types";

const MARK = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

/** 설명서 본문 → 눌러 이동하는 토큰. `[[slug]]`가 자동 연결보다 앞선다. */
export function tokenizeHelp(
  text: string,
  currentSlug?: string,
  allowedSlugs?: ReadonlySet<string>,
): HelpToken[] {
  const out: HelpToken[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...autoLink(text.slice(last, at), currentSlug, allowedSlugs));
    const slug = m[1] ?? "";
    const label = (m[2] ?? slugLabel(slug)).trim() || slug;
    out.push(termOrText(slug, label, currentSlug, allowedSlugs));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...autoLink(text.slice(last), currentSlug, allowedSlugs));
  return mergeText(out);
}

function termOrText(
  slug: string,
  label: string,
  currentSlug: string | undefined,
  allowedSlugs: ReadonlySet<string> | undefined,
): HelpToken {
  if (allowedSlugs && !allowedSlugs.has(slug)) return { type: "text", value: label };
  return { type: "term", slug, label, current: slug === currentSlug };
}

export function slugLabel(slug: string): string {
  const hit = HELP_TERMS.find((t) => t.slug === slug);
  return hit?.pattern ?? slug;
}

function autoLink(
  text: string,
  currentSlug: string | undefined,
  allowedSlugs: ReadonlySet<string> | undefined,
): HelpToken[] {
  if (!text) return [];
  const out: HelpToken[] = [];
  let i = 0;
  while (i < text.length) {
    let hit: (typeof HELP_TERMS)[number] | null = null;
    for (const term of HELP_TERMS) {
      if (text.startsWith(term.pattern, i)) {
        hit = term;
        break;
      }
    }
    if (hit) {
      out.push(termOrText(hit.slug, hit.pattern, currentSlug, allowedSlugs));
      i += hit.pattern.length;
    } else {
      const last = out[out.length - 1];
      if (last?.type === "text") last.value += text[i];
      else out.push({ type: "text", value: text[i] ?? "" });
      i += 1;
    }
  }
  return out;
}

function mergeText(tokens: HelpToken[]): HelpToken[] {
  const out: HelpToken[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (t.type === "text" && last?.type === "text") last.value += t.value;
    else out.push(t.type === "text" ? { type: "text", value: t.value } : { ...t });
  }
  return out.filter((t) => t.type !== "text" || t.value.length > 0);
}
