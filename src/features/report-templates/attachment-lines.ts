/**
 * 영어 글 속 **첨부 자리 줄** 다루기 — 넣기 · 빼기 · 다시 짠 글로 옮겨 심기. 순수 함수(Vitest로 잠금).
 * 줄 모양·읽기(`[첨부: 이름]`)는 image-slots.ts에 있고, 여기는 그 줄을 **어디에** 두는지다.
 *
 * 🔴 첨부 줄은 템플릿 글 밖이다 — `withoutAttachmentLines`는 `insertAttachmentLine`의 **정확한 역**이어야 한다(넣었다 빼면
 *    글자 하나 다르지 않게). 지문 비교(english-draft.ts `templateHashOf`·`isUntouchedTemplateDraft`)가 이 성질에 기댄다.
 * 🔑 자리는 **줄 내용**으로 기억한다 — 바로 위 글 줄(과 그 사이 빈 줄 수), 없으면 바로 아래 글 줄(과 사이 빈 줄 수), 그것도
 *    없으면 줄 번호. 글이 다시 짜이거나(저장 직전·다시 채우기·자동작성) 올리는 동안 강사가 계속 써도 같은 문단 옆에 선다
 *    (줄 번호로만 기억했더니 첫 첨부의 자동 저장이 결과지 줄을 넣고 빼는 사이 사진이 머리말과 내용 사이로 갔다 — 적대 리뷰 2026-09-11).
 */
import { attachmentMarker, attachmentNameOfLine, usedAttachmentNames } from "./image-slots";

const linesOf = (text: string | null | undefined): string[] => (text ?? "").replace(/\r\n?/g, "\n").split("\n");
const isAttachmentLine = (line: string) => attachmentNameOfLine(line) !== null;
const blank = (line: string | undefined) => !(line ?? "").trim();

/** 첨부 줄만 뺀 글. 🔴 빈 줄을 접지 않는다(넣기의 정확한 역). 첨부 줄이 없으면 받은 글 그대로 돌려준다. */
export function withoutAttachmentLines(text: string | null | undefined): string {
  const lines = linesOf(text);
  if (!lines.some(isAttachmentLine)) return text ?? "";
  return lines.filter((line) => !isAttachmentLine(line)).join("\n");
}

/** 첨부 줄 말고 글이 있는가 — 사진만 넣은 빈 행을 '강사가 쓴 글'로 치지 않는다(자동작성·다시 채우기가 덮기를 묻지 않게). */
export function hasTextBesidesAttachments(text: string | null | undefined): boolean {
  return !!withoutAttachmentLines(text).trim();
}

/**
 * 커서 자리 → 첨부 줄을 끼울 줄 번호. 문장을 가르지 않는다:
 * 빈 줄이나 줄 맨 앞이면 **그 줄 앞**, 줄 가운데·끝이면 **그 줄 다음**. 커서를 모르면 글 끝.
 */
export function attachmentLineIndex(text: string | null | undefined, caret: number | null | undefined): number {
  const t = (text ?? "").replace(/\r\n?/g, "\n");
  const at = caret == null || !Number.isFinite(caret) ? t.length : Math.max(0, Math.min(t.length, Math.floor(caret)));
  const before = t.slice(0, at);
  const lineNo = before.split("\n").length - 1;
  const col = at - (before.lastIndexOf("\n") + 1);
  const line = t.split("\n")[lineNo] ?? "";
  return !line.trim() || col === 0 ? lineNo : lineNo + 1;
}

/** 글의 `index`번째 줄 자리에 첨부 줄을 끼운다(범위 밖이면 가장자리). 빈 글이면 그 줄 하나. */
export function insertAttachmentLine(text: string | null | undefined, index: number, name: string): string {
  const t = (text ?? "").replace(/\r\n?/g, "\n");
  if (!t.trim()) return attachmentMarker(name);
  const lines = t.split("\n");
  const i = Number.isFinite(index) ? Math.max(0, Math.min(lines.length, Math.floor(index))) : lines.length;
  lines.splice(i, 0, attachmentMarker(name));
  return lines.join("\n");
}

/** 그 이름의 첨부 줄을 지운다(첨부를 지울 때) — 없으면 받은 글 그대로. */
export function removeAttachmentLines(text: string | null | undefined, name: string): string {
  const lines = linesOf(text);
  const kept = lines.filter((line) => attachmentNameOfLine(line) !== name);
  return kept.length === lines.length ? (text ?? "") : kept.join("\n");
}

type Anchor = { text: string; nth: number } | null;
type Spot = { line: string; name: string; index: number; prev: Anchor; gapBefore: number; next: Anchor; gapAfter: number };

/** 옛 글의 첨부 줄마다 자리 — 위·아래 글 줄(같은 줄이 여럿이면 몇 번째인지) · 사이 빈 줄 수 · 첨부 줄을 뺀 글에서의 줄 번호. */
function spotsOf(prevLines: readonly string[]): Spot[] {
  const plain: string[] = [];
  const found: { line: string; name: string; index: number }[] = [];
  for (const line of prevLines) {
    const name = attachmentNameOfLine(line);
    if (name === null) plain.push(line);
    else found.push({ line: line.trim(), name, index: plain.length });
  }
  const nthOf = (i: number) => plain.slice(0, i + 1).filter((l) => l.trim() === plain[i]!.trim()).length;
  return found.map((f) => {
    let up = f.index - 1;
    while (up >= 0 && blank(plain[up])) up--;
    let down = f.index;
    while (down < plain.length && blank(plain[down])) down++;
    return {
      ...f,
      prev: up >= 0 ? { text: plain[up]!.trim(), nth: nthOf(up) } : null,
      gapBefore: f.index - 1 - up,
      next: down < plain.length ? { text: plain[down]!.trim(), nth: nthOf(down) } : null,
      gapAfter: down - f.index,
    };
  });
}

function findNth(lines: readonly string[], a: NonNullable<Anchor>): number {
  let n = 0;
  for (let j = 0; j < lines.length; j++) if (lines[j]!.trim() === a.text && ++n === a.nth) return j;
  return -1;
}

/** 새 글에서 그 자리의 줄 번호(그 줄 앞에 끼운다). */
function resolveSpot(spot: Spot, lines: readonly string[]): number {
  if (spot.prev) {
    const j = findNth(lines, spot.prev);
    if (j >= 0) {
      let at = j + 1;
      for (let g = spot.gapBefore; g > 0 && at < lines.length && blank(lines[at]); g--) at++;
      return at;
    }
  }
  if (spot.next) {
    const k = findNth(lines, spot.next);
    if (k >= 0) {
      let at = k;
      for (let g = spot.gapAfter; g > 0 && at > 0 && blank(lines[at - 1]); g--) at--;
      return at;
    }
  }
  // 옛 글에 글 줄이 하나도 없었으면(사진부터 넣은 빈 행 → 나중에 자동작성) 새 글 **끝**으로 — 인사말 위에 사진이 서지 않게(적대 재리뷰).
  if (!spot.prev && !spot.next) return lines.length;
  return Math.min(spot.index, lines.length);
}

/**
 * 다시 짠 글(`next`)에 옛 글(`prev`)의 첨부 줄을 옮겨 심는다 — 저장 직전 재조립·다시 채우기·자동작성이 사진 자리를 지우지 않게.
 * `only`면 그 이름만(올리는 동안 바뀐 글에 방금 올린 사진 한 줄을 끼울 때 — 그새 강사가 지운 다른 줄을 되살리지 않게).
 * 새 글에 이미 있는 이름은 다시 넣지 않는다. 🔑 첨부 줄만 끼우므로 `withoutAttachmentLines(결과) === next`가 성립한다.
 */
export function carryAttachmentLines(prev: string | null | undefined, next: string, opts?: { only?: string }): string {
  const prevLines = linesOf(prev);
  if (!prevLines.some(isAttachmentLine)) return next;
  const nextLines = next.replace(/\r\n?/g, "\n").split("\n");
  const present = new Set(usedAttachmentNames(next));
  const inserts: { at: number; line: string }[] = [];
  for (const spot of spotsOf(prevLines)) {
    if ((opts?.only !== undefined && spot.name !== opts.only) || present.has(spot.name)) continue;
    present.add(spot.name);
    inserts.push({ at: resolveSpot(spot, nextLines), line: spot.line });
  }
  if (!inserts.length) return next;
  if (!next.trim()) return inserts.map((i) => i.line).join("\n");
  const out: string[] = [];
  for (let i = 0; i <= nextLines.length; i++) {
    for (const ins of inserts) if (ins.at === i) out.push(ins.line);
    if (i < nextLines.length) out.push(nextLines[i]!);
  }
  return out.join("\n");
}
