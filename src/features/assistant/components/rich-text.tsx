import { parseRich, type RichTone } from "@/features/assistant/rich-text";

/** 뜻이 있는 색 — 앱의 의미색(초록 = 좋음 · 빨강 = 위험 · 앰버 = 주의)과 같은 결. (클래스는 정적 문자열이어야 Tailwind가 만든다.) */
const TONE_CLASS: Record<RichTone, string> = { good: "text-green", bad: "text-danger", warn: "text-amber" };

/**
 * 보고서 글 한 칸 — 강조 표시(`**굵게**` · `[[good:…]]` · `[[bad:…]]` · `[[warn:…]]` — rich-text.ts)만 굵기·색으로 그린다.
 * 🔴 나머지는 모두 글자 그대로(React 글자 노드) — 링크·이미지·HTML은 생기지 않는다. 줄바꿈은 감싼 칸의 `whitespace-pre-line`이 살린다.
 */
export function RichText({ text }: { text: string }) {
  const spans = parseRich(text);
  return (
    <>
      {spans.map((s, i) => {
        if (!s.bold && !s.tone) return s.text;
        const color = s.tone ? TONE_CLASS[s.tone] : "text-foreground";
        return s.bold ? (
          <strong key={i} className={`${color} font-bold`}>
            {s.text}
          </strong>
        ) : (
          <span key={i} className={`${color} font-bold`}>
            {s.text}
          </span>
        );
      })}
    </>
  );
}
