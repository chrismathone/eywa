/**
 * 보고서 글의 강조 표시 — 원장 2026-11-06 *"중요한 문구에는 색상이나 볼드 등 서식을 자유롭게 사용해줘"*
 * (퇴원 사유처럼 긴 글이 전부 같은 굵기·색이라 핵심이 묻혔다). 서버·화면 공용 순수 모듈.
 *
 * 문법(AI가 보고서 글 칸에 쓴다 — prompt.ts '강조'):
 * - `**굵게**`
 * - `[[good:좋은 신호]]` 초록 · `[[bad:나쁜 신호·위험]]` 빨강 · `[[warn:주의]]` 앰버(한국어 이름 좋음·나쁨·위험·주의도 받는다)
 * - 색 안에 굵게, 굵게 안에 색은 된다. 색 안에 색은 안 된다(안쪽 표시는 글자로 남는다).
 * - `\*` `\[` `\]` `\\` = 그 글자 그대로.
 *
 * 🔴 짝이 없거나 비어 있는 표시는 **글자 그대로** 둔다(글을 잃지 않는다). 결과는 글 조각뿐이다 — 링크·이미지·HTML은 생기지 않는다
 *    (화면은 React 글자 노드로 그린다 · report-view.tsx). DB에 있던 남의 글에 표시가 섞여 있어도 굵기·색만 바뀐다.
 */

export type RichTone = "good" | "bad" | "warn";
export type RichSpan = { text: string; bold: boolean; tone: RichTone | null };

const TONE_NAME: Record<string, RichTone> = {
  good: "good",
  bad: "bad",
  warn: "warn",
  좋음: "good",
  나쁨: "bad",
  위험: "bad",
  주의: "warn",
};
const TONE_OPEN = /^\[\[(good|bad|warn|좋음|나쁨|위험|주의):/;
const ESCAPABLE = new Set(["*", "[", "]", "\\"]);

/** `from`부터 찾는 `token` 위치 — `\`로 막은 글자는 건너뛴다. 없으면 -1. */
function findUnescaped(s: string, token: string, from: number, until = s.length): number {
  for (let k = from; k < until; k++) {
    if (s[k] === "\\" && ESCAPABLE.has(s[k + 1] ?? "")) {
      k++;
      continue;
    }
    if (s.startsWith(token, k) && k + token.length <= until) return k;
  }
  return -1;
}

/** 열린 표시가 실제로 닫히는지 — 닫는 곳이 바깥 표시보다 먼저이고, 그 사이 글이 비어 있지 않아야 연다. */
function closes(s: string, contentStart: number, token: string, until: number): boolean {
  const end = findUnescaped(s, token, contentStart, until);
  return end > contentStart && s.slice(contentStart, end).trim().length > 0;
}

/** 글 → 조각(이어진 같은 모양끼리 합친다 · 빈 조각 없음). */
export function parseRich(input: string): RichSpan[] {
  const s = input ?? "";
  const spans: RichSpan[] = [];
  let buf = "";
  let bold = false;
  let tone: RichTone | null = null;
  /** 지금 열린 표시가 끝나는 곳(바깥이 먼저 닫히면 안쪽을 열 수 없다). */
  let boldEnd = s.length;
  let toneEnd = s.length;

  const flush = () => {
    if (!buf) return;
    const last = spans[spans.length - 1];
    if (last && last.bold === bold && last.tone === tone) last.text += buf;
    else spans.push({ text: buf, bold, tone });
    buf = "";
  };

  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (ch === "\\" && ESCAPABLE.has(s[i + 1] ?? "")) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (s.startsWith("**", i)) {
      if (bold) {
        flush();
        bold = false;
        boldEnd = s.length;
        i += 2;
        continue;
      }
      const limit = tone ? toneEnd : s.length;
      if (closes(s, i + 2, "**", limit)) {
        flush();
        bold = true;
        boldEnd = findUnescaped(s, "**", i + 2, limit);
        i += 2;
        continue;
      }
      buf += "**";
      i += 2;
      continue;
    }
    if (ch === "[" && !tone) {
      const m = TONE_OPEN.exec(s.slice(i, i + 12));
      if (m) {
        const contentStart = i + m[0].length;
        const limit = bold ? boldEnd : s.length;
        if (closes(s, contentStart, "]]", limit)) {
          flush();
          tone = TONE_NAME[m[1]!]!;
          toneEnd = findUnescaped(s, "]]", contentStart, limit);
          i = contentStart;
          continue;
        }
      }
    }
    if (tone && i === toneEnd) {
      flush();
      tone = null;
      toneEnd = s.length;
      i += 2;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return spans;
}

/** 표시를 벗긴 글 — AI에게 다시 줄 때 · 낭독·제목·파일 이름 · 글자 수 재기. */
export function plainRich(input: string): string {
  return parseRich(input)
    .map((x) => x.text)
    .join("");
}
