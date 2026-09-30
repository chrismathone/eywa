/**
 * 출결 raw status → 학생 배지 축약(`AttendanceMark`) — **단일 소스**.
 *
 * 같은 표가 세 곳(로스터 · 원스크린 클라 낙관 반영 · 스트립 반영 `applyAppliedAttendance`)에
 * 필요한데, 사본을 두면 한쪽만 고쳐진다(팔레트 v4에서 같은 뜻이 최대 6벌로 갈려 있던 것과 같은 결).
 *
 * ⚠️ 이건 **배지(축약)** 전용이다 — 행(반) 단위 `attendanceRaw`는 조퇴·공결·보강을 그대로 보존한다
 *    (축약값을 되쓰면 raw가 파괴된다, types.ts `attendanceRaw` 주석).
 * ⚠️ 기록이 없으면(undefined·null) "출석"이다 — 종전 두 사본의 동작 그대로(배지는 예외를 말하는 자리라
 *    무기록을 결석으로 단정하지 않는다).
 */
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import { ATT_SOFT } from "@/features/attendance/status-color";
import type { AttendanceMark, OneScreenStudent } from "./types";

/**
 * 조퇴는 **조퇴**다(원장 2026-09-30) — 예전엔 빨간 '결석'으로 접었는데, 그러면 수업을 듣고 일찍 간 아이가
 * 결석한 아이와 같은 배지로 보이고, 그걸 본 강사가 알약을 눌러 기록을 '고치려' 든다.
 * 공결(`excused`)·보강(`makeup`)은 종전대로 '출석'으로 접는다(배지는 예외를 말하는 자리라 이 둘은 이번 범위 밖).
 */
export function attendanceMarkOf(status: string | null | undefined): AttendanceMark {
  return status === "late"
    ? "지각"
    : status === "early_leave"
      ? "조퇴"
      : status === "absent"
        ? "결석"
        : "출석";
}

/**
 * 배지 값 상수 — 🔴 **비교에 쓰는 값**이지 화면 글자가 아니다.
 * 화면에서 이 낱말을 영어로 옮길 때 비교까지 같이 바꾸면 판정이 조용히 뒤집힌다.
 */
export const MARK_PRESENT: AttendanceMark = "출석";
export const MARK_LATE: AttendanceMark = "지각";
export const MARK_EARLY_LEAVE: AttendanceMark = "조퇴";
export const MARK_ABSENT: AttendanceMark = "결석";

/** 배지 값 → 출결 enum. 표기는 앱 전역 `attendanceLabelOf`를 그대로 지난다(표를 새로 만들지 않는다). */
const MARK_STATUS: Record<AttendanceMark, string> = {
  [MARK_PRESENT]: "present",
  [MARK_LATE]: "late",
  [MARK_EARLY_LEAVE]: "early_leave",
  [MARK_ABSENT]: "absent",
};

/** 화면에 적을 배지 글자 — 인자를 안 주면 한국어(기존 호출부 무변경). */
export function attendanceMarkLabel(mark: AttendanceMark, lang: "ko" | "en" = "ko"): string {
  return attendanceLabelOf(MARK_STATUS[mark], lang) ?? mark;
}

/**
 * 배지 색 — 의미색 캐논(status-color.ts): 지각 = caution(amber) · **조퇴 = info(blue)** · 결석 = critical.
 * `strong` = 결석을 채운 빨강(bg-danger)으로 — 표·카드·현황판이 쓰던 모양 그대로. 좌측 목록은 옅은 틴트.
 * 출석은 배지를 안 그리는 화면이 대부분이라 옅은 회색(카드처럼 늘 그리는 자리용).
 */
export function attendanceMarkBadgeClass(mark: AttendanceMark, opts?: { strongAbsent?: boolean }): string {
  if (mark === MARK_LATE) return ATT_SOFT.late;
  if (mark === MARK_EARLY_LEAVE) return ATT_SOFT.early_leave;
  if (mark === MARK_ABSENT) return opts?.strongAbsent ? "bg-danger text-white" : ATT_SOFT.absent;
  return "bg-bg-soft text-text-dim";
}

/**
 * 학생 **한 명**의 배지 = 그 학생의 그날 칸(반) 여럿을 하나로 모은 것. 우선순위(센 쪽이 이긴다):
 *
 *   **결석 > 조퇴 > 지각 > 출석**
 *
 * - 배지는 "이 아이에게 예외가 있다"를 말하는 자리라 가장 무거운 예외가 이긴다 — 영어 출석 + 수학 조퇴 = '조퇴',
 *   영어 결석 + 수학 출석 = '결석'(그날 한 수업을 통째로 빠졌다).
 * - 조퇴가 지각보다 위인 건, 조퇴는 **지금 학원에 없다**는 뜻이라 뒤 수업을 맡은 강사에게 더 급한 정보여서다.
 * - 기록 없는 칸(null)은 셈에 안 넣는다(무기록 ≠ 결석 — 종전 규약). 아무 기록도 없으면 '출석'.
 * - 예전엔 "가장 최근에 찍은 칸"이 배지였다 — 그러면 마지막으로 누른 반이 앞의 결석을 가렸다.
 */
const MARK_RANK: Record<AttendanceMark, number> = {
  [MARK_PRESENT]: 0,
  [MARK_LATE]: 1,
  [MARK_EARLY_LEAVE]: 2,
  [MARK_ABSENT]: 3,
};

export function studentMarkOf(statuses: Iterable<string | null | undefined>): AttendanceMark {
  let best: AttendanceMark = MARK_PRESENT;
  for (const st of statuses) {
    if (!st) continue;
    const m = attendanceMarkOf(st);
    if (MARK_RANK[m] > MARK_RANK[best]) best = m;
  }
  return best;
}

/**
 * 화면의 학생 한 명 → 배지. 로스터(첫 그림)·원스크린 낙관 반영·스트립 반영이 **모두 이 함수**로 배지를 만든다 —
 * 행(반) raw가 진실이고 배지는 거기서 계산한다(따로 들고 다니면 롤백·응답 역전 때 행과 배지가 갈린다).
 * 재료 = 반이 있는 행의 `attendanceRaw` + `attendanceOffRow`(내 반 기록인데 행에 못 붙은 칸 — 로스터가 채운다).
 */
export function studentMarkFromRows(
  student: Pick<OneScreenStudent, "subjects" | "attendanceOffRow">,
): AttendanceMark {
  const raws: (string | null | undefined)[] = [];
  for (const su of student.subjects) if (su.classId) raws.push(su.attendanceRaw);
  for (const st of Object.values(student.attendanceOffRow ?? {})) raws.push(st);
  return studentMarkOf(raws);
}
