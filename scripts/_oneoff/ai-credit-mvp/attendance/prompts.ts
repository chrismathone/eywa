// ④ 결석 문자 — 시험할 프롬프트 판. 'op' = 운영 그대로(intent.ts buildClassifyPrompt). 새 판은 여기 더하고(운영 코드는 건드리지 않는다)
// 나아지면 그 차이를 패치 후보로 낸다 — 운영 적용은 원장 판단 뒤 메인 세션이 한다.
import { buildClassifyPrompt } from "@/features/attendance/parent-alerts/intent";

export type AtRecord = {
  id: string; mid: string; student: string; messageDate: string; content: string; length: number; truncatedAt600: boolean; opBatch: number; held: boolean;
  past: { category: string; startsOn: string | null; endsOn: string | null; detail: string | null; model: string | null };
};
type Item = { id: string; studentName: string; date: string; content: string };

const DOW = "일월화수목금토";
const shift = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (ymd: string) => DOW[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

export const PROMPTS: Record<string, (items: Item[]) => string> = {
  // v2 — 운영 프롬프트 그대로 + 연락일 요일 · 다음 7일 달력(모델이 요일을 셈하지 않게) · 요일 표현 규칙 한 줄. 정책 규칙은 그대로.
  v2: (items) => {
    const withCal = items.map((it) => ({ ...it, date: `${it.date}(${dow(it.date)}) · 다음 7일 ${Array.from({ length: 7 }, (_, i) => { const d = shift(it.date, i + 1); return `${d.slice(5)}(${dow(d)})`; }).join(" ")}` }));
    return buildClassifyPrompt(withCal).replace(
      "- '8월 2일부터 8월 6일까지'처럼 기간이면",
      "- 요일 표현('목요일', '금요일부터')은 연락일 옆 **다음 7일** 목록에서 그 요일의 날짜를 골라라(연락일이 그 요일이면 연락일). 직접 셈하지 말 것.\n- '8월 2일부터 8월 6일까지'처럼 기간이면",
    );
  },
};
