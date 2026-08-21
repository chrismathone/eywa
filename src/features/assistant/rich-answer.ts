// 비서 답변 마크다운-라이트 파서 — 순수 모듈(서버/클라 공용, Vitest).
//
// 배경(2026-08-20 원장 제보): '오늘 출결'을 물으면 모델이 GFM 파이프 표를 뱉는데 패널은
// `whitespace-pre-wrap` 평문이라 `| 반 이름 | 과목 | … |`가 그대로 쏟아졌다. 게다가 시스템
// 프롬프트는 "마크다운 없이"라고 지시하는데 모델은 표를 쓰고 있었다 — **지시와 렌더링이 서로
// 어긋난 상태**. 한쪽으로 정리한다: 표·목록·강조를 **허용하고 안전하게 렌더**한다.
//
// 🔴 렌더러는 `dangerouslySetInnerHTML`을 쓰지 않는다(LLM 출력이다). 이 모듈은 텍스트 → **블록
//    배열**까지만 만들고, React 엘리먼트 조립은 components/answer-body.tsx가 담당한다.
//    파서가 순수라 XSS 표면이 아예 없고(문자열만 다룬다) 표·목록 판정을 Vitest로 잠글 수 있다.
// ⚠️ 새 마크다운 라이브러리를 깔지 않는다(B5 — 답변에 필요한 문법은 표·목록·강조뿐).

export type InlineSegment = { text: string; bold: boolean };

export type AnswerBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

/** 줄 머리의 불릿/번호 마커(- • · * / "1." "1)"). rich-text.tsx와 같은 어휘. */
const BULLET_RE = /^\s*(?:[-•·*]|\d+[.)])\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
/** ATX 헤더(`## 제목`) — 프롬프트가 금지하지만 모델이 흘리면 마커만 벗겨 굵은 줄로 살린다. */
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;
/** 코드펜스 — 모델이 표를 ```로 감싸는 경우가 있어 울타리 줄만 버린다(내용은 그대로 파싱). */
const FENCE_RE = /^\s*```/;

/** 표 구분행(`|---|:--:|`)인가 — GFM은 이 줄이 있어야 표다(산문의 파이프를 표로 오인하지 않게). */
function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, "")));
}

/** 파이프 행처럼 생겼나 — 최소 1개의 `|`와 양끝을 벗긴 뒤 2칸 이상. */
function looksLikeRow(line: string): boolean {
  return line.includes("|") && splitRow(line).length >= 2;
}

/** `| a | b |` → ["a","b"]. 양끝 파이프 제거 후 분할(이스케이프 `\|`는 셀 안 문자로 보존). */
export function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** 열 수를 머리행에 맞춘다 — 모자라면 빈 칸, 넘치면 버림(React 렌더가 들쭉날쭉하지 않게). */
function normalizeRow(cells: string[], width: number): string[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push("");
  return out;
}

/**
 * 답변 텍스트 → 블록 배열. 파이프 표(구분행 필수)·불릿/번호 목록·헤더·문단만 인식한다.
 * 표가 아닌 평문은 줄마다 문단 하나 — 저장된 옛 답변(파이프 없는 평문)도 그대로 살아난다.
 */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: AnswerBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || FENCE_RE.test(line)) {
      i++;
      continue;
    }

    // ① 표 — 머리행 + 구분행이 붙어 있을 때만.
    if (looksLikeRow(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1]!)) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      // 본문 행은 파이프만 있으면 받는다 — 칸이 모자란 행(`| 김민수 |`) 하나 때문에 표 본문이
      // 통째로 잘리지 않게(머리행 판정과 달리 2칸 이상을 요구하지 않는다).
      while (i < lines.length && lines[i]!.includes("|") && !isDelimiterRow(lines[i]!)) {
        rows.push(normalizeRow(splitRow(lines[i]!), head.length));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    // ② 헤더 — 마커만 제거.
    const heading = line.match(HEADING_RE);
    if (heading) {
      const t = heading[1]!.trim();
      if (t) blocks.push({ kind: "heading", text: t });
      i++;
      continue;
    }

    // ③ 목록 — 연속된 마커 줄을 한 덩어리로.
    if (BULLET_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i]!)) {
        const item = lines[i]!.replace(BULLET_RE, "").trim();
        if (item) items.push(item);
        i++;
      }
      if (items.length > 0) blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // ④ 그 밖 — 줄 하나가 문단 하나(RichText와 같은 규약).
    blocks.push({ kind: "paragraph", text: line.trim() });
    i++;
  }
  return blocks;
}

/** 표가 든 답변인가 — 패널이 그 말풍선만 넓게 편다(좁은 말풍선에서 표는 못 읽는다). */
export function answerHasTable(blocks: AnswerBlock[]): boolean {
  return blocks.some((b) => b.kind === "table");
}

/**
 * 인라인 `**강조**` 분해 — 렌더러가 <strong>으로 조립할 조각들.
 * 내부에 단일 별표가 있어도(**a*b**) 매칭되게 non-greedy(rich-text.tsx와 같은 규약).
 */
export function parseInlineSegments(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  for (const part of text.split(/(\*\*[\s\S]+?\*\*)/g)) {
    if (!part) continue;
    const m = part.match(/^\*\*([\s\S]+?)\*\*$/);
    if (m) out.push({ text: m[1]!, bold: true });
    else out.push({ text: part, bold: false });
  }
  return out;
}
