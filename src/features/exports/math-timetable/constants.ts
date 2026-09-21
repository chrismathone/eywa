/**
 * ijw-calander 수학 시간표 익스포터 충실 이식 — 레이아웃 상수.
 * 출처: D:\ijw-calander\components\Timetable\constants.ts (verbatim 발췌).
 *
 * ⚠️ KNOWN_EXCEPTION: 이는 ijw 구글시트 호환을 위한 **내보내기 포맷 상수**(화면 운영 enum 아님)다.
 * 인재원 교시 시각이 aywa defaults.ts(weekdayPeriods/weekendPeriods)와 일치해 출력이 맞는다.
 * aywa 단독 writer 전환 시 설정 도출로 reconcile(후속). CLAUDE.md "운영 enum 하드코딩 금지" 대상 아님.
 */

// 주말용 레거시 교시 시간 (수학 시간표 호환용)
export const WEEKEND_PERIOD_TIMES: Record<string, string> = {
  "1-1": "09:00~10:00",
  "1-2": "10:00~11:00",
  "2-1": "11:00~12:00",
  "2-2": "12:00~13:00",
  "3-1": "13:00~14:00",
  "3-2": "14:00~15:00",
  "4-1": "15:00~16:00",
  "4-2": "16:00~17:00",
};

// 레거시 periodId → 통일된 periodId 매핑
export const LEGACY_TO_UNIFIED_PERIOD_MAP: Record<string, string> = {
  "1-1": "1",
  "1-2": "2",
  "2-1": "3",
  "2-2": "4",
  "3-1": "5",
  "3-2": "6",
  "4-1": "7",
  "4-2": "8",
  // 이미 통일된 ID도 지원
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
};

// 레거시 periodId를 통일된 periodId로 변환
export const convertLegacyPeriodId = (legacyId: string): string => {
  return LEGACY_TO_UNIFIED_PERIOD_MAP[legacyId] || legacyId;
};

// 수학 시간표 그리드용: 그룹화된 교시 목록 (1-1+1-2 → 1교시, ...)
export const MATH_GROUPED_PERIODS = ["1", "2", "3", "4"] as const;

// 수학 시간표 그리드용: 그룹 번호별 포함 교시
export const MATH_GROUP_PERIOD_IDS: Record<string, string[]> = {
  "1": ["1-1", "1-2"], // 1교시 = 1-1 + 1-2
  "2": ["2-1", "2-2"], // 2교시 = 2-1 + 2-2
  "3": ["3-1", "3-2"], // 3교시 = 3-1 + 3-2
  "4": ["4-1", "4-2"], // 4교시 = 4-1 + 4-2
};

// 수학 시간표 그리드용: 그룹 번호별 표시 정보
export const MATH_GROUP_DISPLAY: Record<string, { label: string; time: string }> = {
  "1": { label: "1교시", time: "14:30~16:20" },
  "2": { label: "2교시", time: "16:20~18:10" },
  "3": { label: "3교시", time: "18:20~20:10" },
  "4": { label: "4교시", time: "20:10~22:00" },
};
