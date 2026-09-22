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
import {
  ROSTER_FIXED_LABEL,
  rosterTextCols,
  type MarkTextField,
  type RosterTextCol,
} from "@/features/class-sheets/lib/roster-form";
import { hhmm, type SeatKey } from "./seat";

/**
 * 저장 가능한 JJ 칸 — **영어 시트 JJ 폼과 같은 구성**(원장 2026-09-03: *"seat/jj로 접속하는 출석부에서
 * 영어 강사 시트의 JJ처럼 입력란을 동일하게 맞춰야할듯"*). 순서도 시트와 같다(태도 → 듣기 → 단어 → 특이사항).
 *
 * 🔴 `attitude`는 marks의 `status` 컬럼이다 — **출결이 아니다.** 출결은 `attendance_records`고 이 표는
 *    태도(5단 눈금)를 담는다. 이름이 비슷하다고 두 축을 섞지 말 것.
 * ⚠️ 여기 이름은 화면·저장이 함께 쓰는 키다. 늘릴 땐 `JJ_MARK_COLUMN`·`JJ_MARK_MAXLEN`도 같이(타입이 강제한다).
 */
export const JJ_MARK_FIELDS = ["attitude", "listeningLevel", "memorizedWords", "progressNote"] as const;
export type JjMarkField = (typeof JJ_MARK_FIELDS)[number];

/**
 * `class_sheet_student_marks`의 유니크 축 — upsert 충돌 대상.
 * 🔑 이 칸을 쓰는 문이 셋이다(자리 출석부 손입력 · 영어 시트 · 인재원 단어수 자동 채우기). 문자열을 저마다
 *    적어 두면 한 곳만 축이 어긋나도 **같은 칸이 두 행**으로 갈린다 — 한 곳에서 가져다 쓴다.
 */
export const JJ_MARK_ON_CONFLICT = "tenant_id,class_id,student_id,mark_date,slot_start";

/** 칸 → `class_sheet_student_marks` 컬럼. 영어 시트(`upsertStudentMark`)와 **같은 행·같은 컬럼**이다. */
export const JJ_MARK_COLUMN: Record<JjMarkField, string> = {
  attitude: "status",
  listeningLevel: "listening_level",
  memorizedWords: "memorized_words",
  progressNote: "progress_note",
};

/**
 * 칸별 길이 상한 — 영어 시트(`upsertStudentMark`)와 **같은 값**이어야 한다.
 * 갈리면 같은 기록이 한 화면에선 저장되고 다른 화면에선 거절된다.
 */
export const JJ_MARK_MAXLEN: Record<JjMarkField, number> = {
  attitude: 50,
  listeningLevel: 30,
  memorizedWords: 30,
  progressNote: 500,
};

/** 로그인 JJ실 출석부에만 전용 칸을 그린다. 랩실·공개 PIN은 출결만. */
export function seatHasJjFields(seat: SeatKey): boolean {
  return seat === "jj";
}

export function parseJjMarkField(raw: string | null | undefined): JjMarkField | null {
  const v = raw ?? "";
  return (JJ_MARK_FIELDS as readonly string[]).includes(v) ? (v as JjMarkField) : null;
}

/**
 * 화면에 그릴 **자유 입력 열**(듣기·단어) — ECS JJ 폼과 같은 배열.
 * ⚠️ 태도·특이사항은 여기 없다 — 시트에서도 자유 입력 열 앞뒤에 고정으로 서는 칸이다(`ROSTER_FIXED_LABEL`).
 */
export function jjSeatTextCols(): readonly RosterTextCol[] {
  return rosterTextCols("selfStudy");
}

/**
 * 자유 입력 열(`rosterTextCols`)이 JJ 화면에서 그릴 칸인가 — 시험 점수는 JJ 폼에 없다.
 * ⚠️ 반환 타입은 **`MarkTextField`와의 교집합**이어야 한다(태도·특이사항은 자유 입력 열이 아니다).
 */
export function isJjMarkField(field: MarkTextField): field is Extract<JjMarkField, MarkTextField> {
  return (JJ_MARK_FIELDS as readonly string[]).includes(field);
}

/** 에러 문구·aria에 쓰는 이름 — 화면 라벨과 같은 말(raw 컬럼명 노출 금지). */
export function jjMarkLabel(field: JjMarkField): string {
  if (field === "attitude") return ROSTER_FIXED_LABEL.attitude;
  if (field === "progressNote") return ROSTER_FIXED_LABEL.progressNote;
  return jjSeatTextCols().find((c) => c.field === field)?.label ?? "입력";
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
/**
 * 진도 없이 명단만 그리는 열의 최소 폭 — 이름·출결·태도·듣기·단어·특이사항 여섯 칸.
 * ⚠️ 2026-09-03에 240 → 340으로 올렸다(태도·특이사항 두 칸이 늘어서). 되돌리면 여섯 칸이 40px씩으로
 *    눌려 아무것도 못 읽는다. 폰에서는 `min(100%, …)`가 화면 폭으로 다시 접는다(아래 각주).
 */
// 2026-09-08: 340은 12px 글자 예산이라 v5(16px)에서 출결 칸이 「결석 사유」를 못 담았다 → 계획 열과 같은 440.
export const JJ_SEAT_COL_MIN_PX = 440;

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
