/**
 * JJ실 출석부의 **전용 입력 칸** — 랩실 출석부와 갈라지는 지점.
 *
 * 원장 2026-08-13: JJ 수업은 점수를 없애고 **듣기 레벨 · 누적 암기 단어수**를 적는다.
 * 칸 구성은 ECS 로스터 폼(`roster-form` selfStudy)이 단일 소스다. 여기서 라벨을 다시 쓰지 말 것.
 *
 * 🔴 저장은 `class_sheet_student_marks`다(출결 `attendance_records`가 아님). 영어 시트 JJ 칸과
 *    **같은 행**이라 한쪽에서 고치면 다른 쪽에도 보인다.
 * 🔴 자리 시수(`seat_label`)와는 무관 — 이 칸을 적는다고 담임 정산에서 빠지지 않는다.
 */
import { rosterTextCols, type MarkTextField, type RosterTextCol } from "@/features/class-sheets/lib/roster-form";
import { hhmm, type SeatKey } from "./seat";

export const JJ_MARK_FIELDS = ["listeningLevel", "memorizedWords"] as const;
export type JjMarkField = (typeof JJ_MARK_FIELDS)[number];

export const JJ_MARK_MAXLEN = 30;

/** 로그인 JJ실 출석부에만 전용 칸을 그린다. 랩실·공개 PIN은 출결만. */
export function seatHasJjFields(seat: SeatKey): boolean {
  return seat === "jj";
}

export function parseJjMarkField(raw: string | null | undefined): JjMarkField | null {
  const v = raw ?? "";
  return (JJ_MARK_FIELDS as readonly string[]).includes(v) ? (v as JjMarkField) : null;
}

/** 화면에 그릴 열 — ECS JJ 폼과 같은 배열. */
export function jjSeatTextCols(): readonly RosterTextCol[] {
  return rosterTextCols("selfStudy");
}

export function isJjMarkField(field: MarkTextField): field is JjMarkField {
  return (JJ_MARK_FIELDS as readonly string[]).includes(field);
}

/** 낙관적 오버레이 키 — 교시가 빠지면 16:20에 적은 값이 17:20에 묻는다. */
export function seatOverlayKey(classId: string, studentId: string, slotStart: string): string {
  return `${classId}|${studentId}|${hhmm(slotStart)}`;
}

/**
 * 진도(수업계획) 구획이 붙은 열의 최소 폭 — **영어 시트 요일 열과 같은 치수**
 * ([`TODAY_PLAN_W`](@/features/class-sheets/lib/today-columns) 432 + 좌우 여백).
 * 🔑 계획 표는 고정 열 268px + 진도·과제 2칸이라, 시트가 실제로 쓰는 폭보다 좁히면 그 두 칸이
 *    슬리버로 무너진다. 여기서 줄이려면 `plan-table` 콜그룹부터 함께 줄여야 한다.
 */
export const JJ_PLAN_COL_MIN_PX = 440;
/** 출결만 그리는 열의 최소 폭 — 이름·출결·듣기·단어 넉 칸. */
export const JJ_SEAT_COL_MIN_PX = 240;

/**
 * 반 N개 = 열 N개. auto-fill은 창이 넓으면 빈 칸을 만들고, 좁으면 반을 다음 줄로 내린다.
 *
 * ⚠️ 좁은 화면에선 이 격자가 통째로 가로 스크롤한다(반 2개면 240px일 때도 이미 그렇다) —
 *    **스크롤러는 하나뿐**이라야 어느 쪽이 움직이는지 헷갈리지 않는다. 열 안에 또 가로 스크롤을
 *    만들지 말 것.
 * 🔑 그래서 최소 폭은 `min(100%, …)`다: 폰에서 열 하나가 화면보다 넓어지면 **출결을 찍는 데도**
 *    가로로 끌어야 한다(실측 390px에서 진도 열 440px = 누적 단어수 칸이 잘렸다). 화면보다 좁아지면
 *    계획 표의 진도·과제가 좁아지지만 그 칸은 한 줄 입력이라 안에서 스크롤된다 — 잘리는 것보다 낫다.
 *    반 사이를 오가는 가로 스크롤은 그대로 남는다(그건 반이 여럿이라 생기는 것).
 */
export function jjClassColumns(classCount: number, minPx: number = JJ_SEAT_COL_MIN_PX): string {
  return `repeat(${Math.max(1, classCount)}, minmax(min(100%, ${minPx}px), 1fr))`;
}
