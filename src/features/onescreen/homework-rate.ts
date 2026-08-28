/**
 * 과제 수행률 — **퍼센트 값의 단일 소스**(숫자 변환 + 문장 조각).
 *
 * 🔴 왜 퍼센트인가(원장 지시 2026-08-03, 강사 제보):
 *    선택지가 `완료 / 일부 미흡 / 미제출` 세 단계였을 때, 과제를 **90% 해온 학생**을 강사가
 *    '일부 미흡'으로 체크했더니 학부모 카드의 추이 그래프엔 **50**이 찍혔다. 학부모는 그 숫자를
 *    보고 학생을 혼냈다. "일부 미흡"에는 **정도가 없는데** 그래프는 숫자를 요구했고, 그 빈칸을
 *    코드가 50으로 메웠다 — 강사가 하지 않은 판단이 강사 이름으로 학부모에게 나간 것이다.
 *    (2026-07-23~08-02에 '일부 미흡'으로 **발송된 보고서 56건**이 이 경로를 탔다.)
 *
 * 규약 세 줄:
 *  ① 입력은 **강사가 직접 치는 퍼센트**([HomeworkRateInput](./components/homework-rate-input.tsx) —
 *     숫자 칸 + `%`). 눈금·선택지 없음(10% 눈금 드롭다운은 *"고르기 너무 힘들다"*로 반려됐다).
 *  ② 옛 정성값은 **뜻이 분명한 것만** 숫자로 읽는다 — `완료`=100 · `미제출`=0.
 *     🔴 `일부 미흡`은 정도를 모르므로 **null**(그래프·평균에서 제외). **다시 50으로 되돌리지 말 것.**
 *  ③ 숫자로 바꾸는 곳은 **여기 하나**다. 그래프([report-trend.ts])도 재원위험([retention/homework-score.ts])도
 *     이 함수를 거친다 — 매핑이 흩어져 있으면 한 곳만 고쳐 다시 어긋난다(이 사고가 그랬다).
 */
import { isNoneValue, NONE_LABEL } from "./none-marker";

/**
 * **미제출** — 0%와 수행률은 같지만(그래프 0) 학부모에게 나가는 문장이 다르다(원장 2026-08-03).
 * 입력칸의 '미제출' 칩이 이 값을 넣는다. 옛 원스크린 선택지에도 있던 표기라 이관분과 그대로 호환된다.
 */
export const NOT_SUBMITTED = "미제출";

/** 뜻이 분명한 옛 표기 → 퍼센트. ⚠️ 정도를 모르는 값(`일부 미흡`·`상/중/하`)은 여기에 넣지 말 것. */
const LEGACY_EXACT: Record<string, number> = {
  완료: 100,
  [NOT_SUBMITTED]: 0,
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * 저장된 값 → 0~100 수행률 | null.
 *  · `"90%"`·`"90"` → 90 (현재 입력 + edutrix 임포트 계보)
 *  · `완료` → 100 · `미제출` → 0
 *  · `일부 미흡`·`상`·`미확인` 등 **정도 미상** → null
 *  · `없음`·`-`·빈칸(= 과제가 없던 날/미기재) → null
 * null은 "0%"가 아니라 **"숫자로 말할 수 없음"**이다 — 호출부는 평균·그래프에서 제외할 것.
 */
export function parseHomeworkRate(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s || isNoneValue(s)) return null;
  const exact = LEGACY_EXACT[s];
  if (exact !== undefined) return exact;
  // 숫자만(퍼센트 기호는 있어도 없어도, 임포트 오타 `100%%`도) — 그 외 문자가 섞이면 측정값이 아니다.
  // (실제로 `100%\n90%\n50%\n0%`처럼 edutrix 선택지 목록이 통째로 저장된 행 19건이 있다 → null이 맞다.)
  const m = s.match(/^(\d{1,3})\s*%*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? clamp(n) : null;
}

/** 숫자 → 저장·표시 문자열. 값의 표기는 이 함수 하나로 통일한다(`"90%"`). */
export function formatHomeworkRate(n: number): string {
  return `${clamp(n)}%`;
}

/**
 * 옛 값 → **현재 표기**(이전 회차 가져오기용). 완료→"100%" · 없음→"없음" · 미제출→"미제출"(그대로).
 * 정도 미상(`일부 미흡` 등)은 null — 강사가 직접 치게 둔다(임의로 50%를 찍지 않는다).
 */
export function toHomeworkRateChoice(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (isNoneValue(s)) return NONE_LABEL;
  if (s === NOT_SUBMITTED) return NOT_SUBMITTED; // 0%로 바꾸면 '안 내왔다'와 '못 했다'가 뭉개진다
  const n = parseHomeworkRate(s);
  return n == null ? null : formatHomeworkRate(n);
}

/**
 * 폴백 템플릿 문장에 넣을 조각(주어 "지난 과제는" 뒤에 붙는다).
 *  · `"90%"`  → `"90% 해왔습니다"` (그냥 "90%입니다"로 두면 무엇의 90%인지 모호하다)
 *  · `"100%"` → `"다 해왔습니다"` · `"0%"` → `"하지 못했습니다"`(손은 댔지만 한 게 없다)
 *  · `"미제출"` → `"제출하지 않았습니다"` — 🔴 **0%와 다른 문장**(원장 2026-08-03). 그래프에선 둘 다 0이지만
 *    학부모에게 전하는 말은 다르다: 0%는 "못 했다", 미제출은 "안 내왔다".
 *    그리고 `없음`(과제가 없던 날)은 아예 **문장에 넣지 않는다**(호출부가 isNoneValue로 거른다).
 *  · 그 밖의 옛 정성값(`완료`) → `"완료입니다"` (기존 동작 보존)
 * ⚠️ 여기서 값을 **해석·평가하지 말 것** — 강사가 적은 값을 그대로 옮기는 자리다.
 */
export function homeworkRateClause(raw: string): string {
  const s = raw.trim();
  if (s === NOT_SUBMITTED) return "제출하지 않았습니다";
  if (!/^\d{1,3}\s*%$/.test(s)) return `${s}입니다`;
  const n = parseHomeworkRate(s);
  if (n === 0) return "하지 못했습니다";
  if (n === 100) return "다 해왔습니다";
  return `${s} 해왔습니다`;
}

/**
 * AI 프롬프트 [입력] 블록에 넣을 과제 값 — **`0%`와 `미제출`만 말로 갈라 준다.**
 *
 * 🔴 왜 데이터에서 가르나: 프롬프트 본문엔 이미 *"`0%`는 하나도 해오지 못한 것, `미제출`은 제출하지 않은 것,
 *    셋을 바꿔 쓰지 마세요"* 라는 규칙이 있는데도 모델이 `0%`를 "제출하지 않았습니다"로 바꿔 썼다
 *    (2026-08-28 실측, Haiku). 그 규칙은 **원장이 화면에서 편집 가능한 프롬프트 본문**(`ai_prompt_overrides`)에
 *    살고 데이터는 코드에 산다 — 지울 수 없는 자리에 둬야 "항상"이 성립한다(FACT_GUARD와 같은 결).
 *    두 값의 차이는 학부모가 아이를 혼내느냐 마느냐를 가른다("안 냈다" vs "못 했다").
 *
 * ⚠️ 값에 **괄호 설명을 달지 않는다** — 모델이 괄호째 베껴 학부모 문장에 넣는다(2026-07-22 실측:
 *    "이전 진도 범위 일일테스트에서…" 40건 중 8건 누출). 그래서 숫자를 지우고 **뜻만 남긴 짧은 명사구**로 준다.
 * ⚠️ 0이 아닌 퍼센트는 **그대로** — "90%"는 미제출과 헷갈릴 여지가 없고, 그 숫자가 멘트에 그대로 나가야 한다
 *    (프롬프트가 "퍼센트는 적힌 그대로, '대부분'·'거의 다'로 뭉개지 마세요"라고 못박은 값이다).
 * ⚠️ `없음`(과제가 없던 날)은 여기서 건드리지 않는다 — 프롬프트가 따로 다루고, 뜻이 이미 분명하다.
 */
export function homeworkFactValue(raw: string): string {
  const s = raw.trim();
  if (s === NOT_SUBMITTED) return "제출하지 않음";
  if (isNoneValue(s)) return s;
  return parseHomeworkRate(s) === 0 ? "하나도 해오지 못함" : s;
}
