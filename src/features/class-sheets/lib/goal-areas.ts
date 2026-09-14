/**
 * 주간 시트 **왼쪽 계획 표**(담임/부담임 × 월간/주간)의 행 — 반 트랙별 단일 소스(순수 · Vitest).
 * 서버(조회·저장 검증)와 클라가 함께 쓰므로 `server-only` 금지([[#61]]).
 *
 * 원장 2026-09-14: *"EiE 왼쪽 월간 계획은 달력입력란에 맞게 메뉴 변경. 인재원영어와 구분."*
 * → **EiE 반** = 월간 계획서(MP) 달력의 칸 이름 그대로 `In-class · Homework · Test`(e-book 제외 —
 *   요일마다 있다 없다 하는 칸이라 목표 행으로 세우지 않는다). **인재원 영어·미분류** = 학원설정 영역(기본 6영역) 그대로.
 *
 * 🔴 **왼쪽 표만**이다 — 교시 계획 줄의 '구분' 드롭다운(`data.skillAreas`)은 EiE도 6영역 그대로다.
 *    두 목록을 한 값으로 묶으면 계획 줄에 `In-class`가 뜬다.
 * 🔴 EiE 행은 MP 열 정의(`MP_BASE_COLUMNS`·`MP_COLUMN_LABEL`)에서 **파생**한다 — 이름을 여기 다시 적으면
 *    달력의 칸 이름이 바뀔 때 왼쪽 표만 옛 이름으로 남는다.
 * 🔴 판정은 `english_track` 컬럼 하나(반 이름으로 추측 금지)이고 **정확히 EiE일 때만** 바꾼다 —
 *    미분류는 인재원 쪽(MP 탭을 세우는 판정과 같은 비대칭).
 * ⚠️ 저장(`upsertGoal`)도 이 목록을 **허용 목록**으로 쓴다 — 화면 행과 서버 허용이 갈리면
 *    "칸은 보이는데 저장이 거절"되거나, 주소만 알면 다른 트랙의 키가 들어간다(#77).
 */
import type { EnglishTrack } from "@/features/classes/english-track";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { MP_BASE_COLUMNS, MP_COLUMN_LABEL } from "./month-plan";

export function goalAreasFor(
  track: EnglishTrack | null,
  skillAreas: readonly SkillAreaSetting[],
): SkillAreaSetting[] {
  if (track !== "eie") return [...skillAreas];
  // 색은 무채색 — 계획 줄의 영역 색(Vocab 파랑·Listening 보라…)을 빌리면 같은 화면에서
  // "In-class = Vocab"처럼 읽힌다(뜻이 다르면 색도 다르다). MP 달력 머리 칸도 흰 바탕 검은 글자다.
  return MP_BASE_COLUMNS.map((key) => ({ key, label: MP_COLUMN_LABEL[key], color: "neutral" as const }));
}

/** 이 반에서 목표로 저장할 수 있는 영역 키인가 — `goalAreasFor`와 같은 목록. */
export function isGoalAreaAllowed(
  track: EnglishTrack | null,
  skillAreas: readonly SkillAreaSetting[],
  key: string,
): boolean {
  return goalAreasFor(track, skillAreas).some((a) => a.key === key);
}
