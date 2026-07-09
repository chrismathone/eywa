import { Fragment, type ReactNode } from "react";

// AI 산문 텍스트를 줄바꿈·불릿·강조로 안전 렌더(서버 컴포넌트 가능, hook·dangerouslySetInnerHTML 미사용).

// **굵게** 인라인 파싱 → <strong>. 내부에 단일 별표가 있어도(**a*b**) 매칭되게 non-greedy.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[\s\S]+?\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([\s\S]+?)\*\*$/);
    return m ? (
      <strong key={i} className="text-foreground font-semibold">
        {m[1]}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

// 줄 머리의 불릿/번호 마커(- • · * / "1." "1)") 감지·제거.
const BULLET_RE = /^\s*(?:[-•·*]|\d+[.)])\s+/;

// 괄호 깊이를 존중하며 최상위 쉼표(, ，)로 분할 — "어려움(숙제 부담, 문법·쓰기)" 같은 괄호 안 쉼표는 안 쪼갬.
export function splitTopLevelCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "（" || ch === "[") depth++;
    else if (ch === ")" || ch === "）" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "，") && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((b, i) => {
        // '→'로 시작하는 줄(질문의 답변 등)은 앞 항목의 하위줄 — 불릿(●) 없이 들여쓰기(모델이 답변을
        // 새 줄로 뱉어도 별도 불릿이 붙지 않게). 등록상담 학부모 질문 '- 질문\n→ 답변' 대응.
        const isSub = /^→/.test(b);
        if (isSub) {
          return (
            <li key={i} className="text-text-dim min-w-0 pl-5 break-keep">
              {renderInline(b)}
            </li>
          );
        }
        return (
          <li key={i} className="flex gap-2">
            <span className="text-primary/60 mt-[2px] shrink-0 text-xs">●</span>
            <span className="min-w-0 break-keep">{renderInline(b)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * AI 분석 텍스트 렌더러 — 가독성 처리:
 * - `\n`으로 줄을 나누고, 불릿/번호 마커 줄은 <ul>로, 아니면 <p>로.
 * - `bulletize`(리스트형 섹션): `\n`이 없으면 **괄호 인식 쉼표 분할**로 나열을 불릿으로(모델이 줄바꿈을
 *   안 줘도 견고). `\n`이 있으면 각 줄을 불릿으로.
 * - **강조**는 항상 <strong>으로. AI가 한 덩어리로 줘도 최소 한 문단으로 안전 렌더.
 */
export function RichText({
  text,
  bulletize = false,
  className,
}: {
  text: string;
  bulletize?: boolean;
  className?: string;
}) {
  const wrap = (children: ReactNode) => (
    <div className={className ?? "text-foreground space-y-1.5 text-sm leading-relaxed"}>{children}</div>
  );

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null; // 빈/공백 입력 — 빈 문단 렌더 방지(호출부 가드 없이 재사용해도 안전).

  // 줄바꿈 있음 — 불릿/번호 줄이 절반 이상이거나 bulletize면 리스트, 아니면 문단.
  if (lines.length > 1) {
    const markedCount = lines.filter((l) => BULLET_RE.test(l)).length;
    if (bulletize || markedCount >= Math.ceil(lines.length / 2)) {
      return wrap(<BulletList items={lines.map((l) => l.replace(BULLET_RE, ""))} />);
    }
    return wrap(
      lines.map((l, i) => (
        <p key={i} className="break-keep">
          {renderInline(l.replace(BULLET_RE, ""))}
        </p>
      )),
    );
  }

  // 단일 줄 — 리스트형이면 괄호 인식 쉼표 분할로 불릿화.
  const single = lines[0] ?? "";
  if (bulletize) {
    const parts = splitTopLevelCommas(single.replace(BULLET_RE, ""));
    if (parts.length >= 2) return wrap(<BulletList items={parts} />);
  }
  return wrap(<p className="break-keep">{renderInline(single.replace(BULLET_RE, ""))}</p>);
}
