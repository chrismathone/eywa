/**
 * 과제 수행률 — **퍼센트 값의 단일 소스**(선택지 + 숫자 변환).
 *
 * 🔴 왜 퍼센트인가(원장 지시 2026-08-03, 강사 제보):
 *    선택지가 `완료 / 일부 미흡 / 미제출` 세 단계였을 때, 과제를 **90% 해온 학생**을 강사가
 *    '일부 미흡'으로 체크했더니 학부모 카드의 추이 그래프엔 **50**이 찍혔다. 학부모는 그 숫자를
 *    보고 학생을 혼냈다. "일부 미흡"에는 **정도가 없는데** 그래프는 숫자를 요구했고, 그 빈칸을
 *    코드가 50으로 메웠다 — 강사가 하지 않은 판단이 강사 이름으로 학부모에게 나간 것이다.
 *    (2026-07-23~08-02에 '일부 미흡'으로 **발송된 보고서 56건**이 이 경로를 탔다.)
 *
 * 규약 세 줄:
 *  ① 입력은 **10% 눈금 퍼센트**(`HOMEWORK_RATES`). 강사가 고른 숫자가 그대로 학부모에게 간다.
 *  ② 옛 정성값은 **뜻이 분명한 것만** 숫자로 읽는다 — `완료`=100 · `미제출`=0.
 *     🔴 `일부 미흡`은 정도를 모르므로 **null**(그래프·평균에서 제외). **다시 50으로 되돌리지 말 것.**
 *  ③ 숫자로 바꾸는 곳은 **여기 하나**다. 그래프([report-trend.ts])도 재원위험([retention/homework-score.ts])도
 *     이 함수를 거친다 — 매핑이 흩어져 있으면 한 곳만 고쳐 다시 어긋난다(이 사고가 그랬다).
 */
import { isNoneValue } from "./none-marker";

/** 과제 수행률 선택지(높은 값 먼저 — 실측 최빈값이 100%·90%다). 10% 눈금. */
export const HOMEWORK_RATES = [
  "100%",
  "90%",
  "80%",
  "70%",
  "60%",
  "50%",
  "40%",
  "30%",
  "20%",
  "10%",
  "0%",
] as const;

/** 뜻이 분명한 옛 표기 → 퍼센트. ⚠️ 정도를 모르는 값(`일부 미흡`·`상/중/하`)은 여기에 넣지 말 것. */
const LEGACY_EXACT: Record<string, number> = {
  완료: 100,
  미제출: 0,
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * 저장된 값 → 0~100 수행률 | null.
 *  · `"90%"`·`"90"` → 90 (edutrix 임포트 계보 + 새 선택지)
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

/** 값이 새 선택지(10% 눈금)에 그대로 있는가. */
export function isHomeworkRate(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  return (HOMEWORK_RATES as readonly string[]).includes(s);
}

/**
 * 옛 값 → **현재 선택지 중 하나**(이전 회차 가져오기용). 10% 눈금으로 반올림한다.
 * 정도 미상(`일부 미흡` 등)은 null — 강사가 직접 고르게 둔다(임의로 50%를 찍지 않는다).
 */
export function toHomeworkRateChoice(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (isNoneValue(s)) return "없음";
  if (isHomeworkRate(s)) return s;
  const n = parseHomeworkRate(s);
  if (n == null) return null;
  const snapped = `${Math.round(n / 10) * 10}%`;
  return isHomeworkRate(snapped) ? snapped : null;
}

/**
 * 폴백 템플릿 문장에 넣을 조각(주어 "지난 과제는" 뒤에 붙는다).
 *  · `"90%"` → `"90% 해왔습니다"` (그냥 "90%입니다"로 두면 무엇의 90%인지 모호하다)
 *  · `"0%"`  → `"하지 못했습니다"` ("0% 해왔습니다"는 한국어가 아니다)
 *  · 옛 정성값(`완료`) → `"완료입니다"` (기존 동작 보존)
 * ⚠️ 여기서 값을 **해석·평가하지 말 것** — 강사가 고른 숫자를 그대로 옮기는 자리다.
 */
export function homeworkRateClause(raw: string): string {
  const s = raw.trim();
  if (!/^\d{1,3}\s*%$/.test(s)) return `${s}입니다`;
  return parseHomeworkRate(s) === 0 ? "하지 못했습니다" : `${s} 해왔습니다`;
}
