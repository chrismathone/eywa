/**
 * **출결 사유 프리셋 표시 라벨** — 강사뷰 영어 화면(원장 2026-09-04 *"강사가 접근 가능한 모든 메뉴를 전환"*).
 *
 * 🔴🔴 **저장값은 한국어 그대로다.** [`reason-presets.ts`](@/features/attendance/quick/reason-presets)의
 * 문자열이 곧 `attendance_records.note`이고, [`classifyAbsenceReason`](@/features/attendance/absence-reason)이
 * 그 한국어를 읽어 '오늘 출결'·'어제 요약'의 **긴급 여부**를 정한다. 그래서 이 모듈은 **화면에 적는
 * 글자만** 바꾼다 — 영어로 골라도 저장은 `여행`이고 데스크·학부모 연락 판정은 한 글자도 안 바뀐다.
 * 🔴 그러니 이 함수를 **저장 경로에 끼우지 말 것**(영어로 저장하면 분류기가 전건 `unknown`으로 떨어져,
 *    사유를 골랐는데 화면은 "연락 안 됨 긴급"이라고 말한다 — 그 정합은 `reason-presets.test.ts`가 잠근다).
 *
 * ⚠️ **프리셋 밖 값(자유 입력·옛 메모)은 그대로 돌려준다** — 옮길 표가 없으니 원문이 정답이다
 *    (태도 라벨 [`attitude-label.ts`](./attitude-label.ts)와 같은 규약).
 * ⚠️ 사전(`i18n.ts`)이 아니라 **여기** 두는 이유: 키가 저장값(한국어)이라 사전 키 규약(`영역.이름`)과
 *    모양이 다르고, 프리셋이 늘면 그 파일 옆에서 짝을 맞추는 편이 빠뜨릴 확률이 낮다.
 */
import {
  ABSENCE_REASON_PRESETS,
  LATE_REASON_PRESETS,
} from "@/features/attendance/quick/reason-presets";
import type { SheetLang } from "./i18n";

/** 결석 사유 프리셋(저장값) → 영어 표기. 🔴 `ABSENCE_REASON_PRESETS`와 **같은 집합**이어야 한다. */
const ABSENCE_EN: Record<string, string> = {
  여행: "Trip",
  가족여행: "Family trip",
  휴가: "Vacation",
  병결: "Sick",
  가족일정: "Family event",
  캠프: "Camp",
  병원: "Hospital",
  "학교 행사": "School event",
  개인사정: "Personal",
};

/** 지각 사유 프리셋(저장값) → 영어 표기. 🔴 `LATE_REASON_PRESETS`와 **같은 집합**이어야 한다. */
const LATE_EN: Record<string, string> = {
  "학교 종례 늦음": "School ran late",
  "버스 놓침": "Missed the bus",
  "시간 착각": "Mixed up the time",
  "다른 학원": "Another academy",
};

function labelWith(map: Record<string, string>, value: string | null | undefined, lang: SheetLang) {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (lang !== "en") return v;
  return map[v] ?? v; // 모르는 값(자유 입력)은 원문 그대로
}

/** 화면에 적을 결석 사유. */
export function absenceReasonLabelFor(value: string | null | undefined, lang: SheetLang) {
  return labelWith(ABSENCE_EN, value, lang);
}

/** 화면에 적을 지각 사유. */
export function lateReasonLabelFor(value: string | null | undefined, lang: SheetLang) {
  return labelWith(LATE_EN, value, lang);
}

/** 가드용 — 프리셋 전건이 영어 표를 갖고 있는지 테스트가 확인한다. */
export const REASON_LABEL_TABLES = {
  absence: { presets: ABSENCE_REASON_PRESETS, en: ABSENCE_EN },
  late: { presets: LATE_REASON_PRESETS, en: LATE_EN },
} as const;
