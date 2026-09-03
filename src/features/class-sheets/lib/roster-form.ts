/**
 * 로스터 **입력 칸 구성**(폼) — 교시마다 다르다. 순수 모듈이라 서버·클라 공용이고 Vitest가 잠근다.
 *
 * 원장 2026-08-13: *"JJ 수업만 특별한 커스텀 폼을 가지게 해야겠어. 점수를 없애고 듣기 레벨, 누적 암기
 * 단어수를 추가해줘. 이건 그냥 텍스트 입력으로. 특이사항은 좀 줄여도 돼"* + 기존 '점수' → **'시험 점수'**.
 *
 * 🔴 **폼은 반이 아니라 교시(슬롯)가 정한다.** JJ(집중자율수업실)는 사람이 아니라 **자리**이고
 *    (`teacher-label.ts`), 같은 반이 4교시는 강사 수업·5교시는 JJ인 경우가 실제로 있다(실측 2026-08-13:
 *    live JJ 슬롯 48개가 20개 넘는 반에 흩어져 있다). 그래서 판정 입력은 슬롯의 `slot_teacher_label`이다.
 * 🔴 **자리 판정은 `specialSlotLabel` 하나만** 쓴다 — 반 이름·강의실로 추측하지 말 것(이름을 고치면
 *    분류가 조용히 뒤집힌다, english-track과 같은 규약).
 *
 * ⚠️ 폼이 바뀌어도 **저장된 값은 안 지운다.** 화면에 없는 칸(예: JJ 교시의 시험 점수)은 서버로 아예
 *    안 보내고(=그 칸은 지금 값 유지), 자리가 바뀌면 다시 보인다. 화면에서 감추는 것과 DB에서 지우는
 *    것은 다르다(hiddenSeatOf 각주와 같은 원칙).
 */
import { SELF_STUDY_ROOM_LABEL, specialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** 한 학생의 그 교시 기록(class_sheet_student_marks 한 행) — 화면·서버가 같은 모양으로 주고받는다. */
export type SheetMark = {
  status: string | null;
  progressNote: string | null;
  /** 0202a. 원장 2026-08-13 라벨을 '시험 점수'로(컬럼명·저장값은 불변 — 라벨만). */
  score: string | null;
  /** 0206a — JJ 전용. */
  listeningLevel: string | null;
  /** 0206a — JJ 전용. */
  memorizedWords: string | null;
};

/**
 * 자유 입력 열 앞뒤에 **늘 서는 두 칸**의 라벨 — 화면마다 다시 적지 말 것.
 * (영어 시트 로스터 표와 JJ실 자리 출석부가 같은 글자를 써야 한 화면에서 배운 이름이 다른 화면에서 안 바뀐다.)
 * ⚠️ `attitude`의 저장 컬럼 이름은 `status`지만 뜻은 **태도**다 — 출결과 헷갈리지 말 것.
 */
export const ROSTER_FIXED_LABEL = { attitude: "태도", progressNote: "특이사항" } as const;

/** 자유 입력 칸(태도와 특이사항 사이) — 폼이 어느 것을 그릴지 정한다. */
export type MarkTextField = "score" | "listeningLevel" | "memorizedWords";

export type RosterForm = "default" | "selfStudy";

export type RosterTextCol = {
  field: MarkTextField;
  /** 표 머리 라벨(화면 문자열 — 여기가 단일 소스). */
  label: string;
  /** 열 폭(px) — 주간 시트 colgroup과 오늘 면 레일이 **같은 값**을 쓴다. */
  width: number;
  title: string;
  /** 키보드 세로 이동(grid-nav) 열 식별자 — 열마다 달라야 Enter/↑↓가 옆 칸으로 새지 않는다. */
  nav: string;
};

/**
 * 폼별 자유 입력 열. **여기 폭을 고치면 특이사항이 그만큼 줄어든다**(특이사항이 잔여를 받는다) —
 * 오늘 면은 `todaySlotCols`가 항등식(합 = 교시 폭)을 지키고 테스트가 그걸 잠근다.
 */
export const ROSTER_TEXT_COLS: Record<RosterForm, readonly RosterTextCol[]> = {
  // ⚠️ 폭은 **머리 라벨이 한 줄에 들어가는 최소치 + 여유**다(11px bold 실측 2026-08-13: '듣기 레벨'
  //    41px · '누적 암기 단어수' 72px, '시험 점수'는 같은 셈법으로 ≈48px). 더 줄이면 머리가 두 줄이 되고,
  //    나란한 카드들 사이에서 그 카드만 학생 줄이 아래로 밀려 `grid-rows-subgrid` 줄맞춤이 깨진다(2026-08-04
  //    규약). 2026-08-17 열 다이어트(원장 "줄일 수 있는 곳은 다 줄여보자")로 이 하한 근처까지 내렸다
  //    — dev 실측으로 세 머리 모두 한 줄 유지 확인.
  default: [
    {
      field: "score",
      label: "시험 점수",
      width: 52,
      title: "이 교시의 시험 점수 — 자유 입력(18/20 · 95 · A 등)",
      nav: "ecs-score",
    },
  ],
  selfStudy: [
    {
      field: "listeningLevel",
      label: "듣기 레벨",
      width: 48,
      title: "JJ(집중자율수업실) 듣기 레벨 — 자유 입력",
      nav: "ecs-listening",
    },
    {
      field: "memorizedWords",
      label: "누적 암기 단어수",
      width: 78,
      title: "지금까지 외운 누적 단어 수 — 자유 입력",
      nav: "ecs-words",
    },
  ],
};

/** 이 교시가 쓸 폼 — JJ(집중자율수업실) 자리면 전용 폼, 그 외(강사 수업·LAB·고아 슬롯)는 기본. */
export function rosterFormOf(slotTeacherLabel: string | null | undefined): RosterForm {
  return specialSlotLabel(slotTeacherLabel) === SELF_STUDY_ROOM_LABEL ? "selfStudy" : "default";
}

/** 그 폼의 자유 입력 열들. */
export function rosterTextCols(form: RosterForm): readonly RosterTextCol[] {
  return ROSTER_TEXT_COLS[form];
}

/** 표 한 행의 칸 수 = 이름 + 출결·유닛·태도 + 자유 입력 N + 특이사항 (colSpan 계산용). */
export function rosterColSpan(form: RosterForm): number {
  return 5 + ROSTER_TEXT_COLS[form].length;
}
