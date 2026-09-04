/**
 * 출결 raw status → 학생 배지 축약(`AttendanceMark`) — **단일 소스**.
 *
 * 같은 표가 세 곳(로스터 `toMark` · 원스크린 클라 `markOf` · 스트립 반영 `applyAppliedAttendance`)에
 * 필요한데, 사본을 두면 한쪽만 고쳐진다(팔레트 v4에서 같은 뜻이 최대 6벌로 갈려 있던 것과 같은 결).
 *
 * ⚠️ 이건 **배지(축약)** 전용이다 — 행(반) 단위 `attendanceRaw`는 조퇴·공결·보강을 그대로 보존한다
 *    (축약값을 되쓰면 raw가 파괴된다, types.ts `attendanceRaw` 주석).
 * ⚠️ 기록이 없으면(undefined·null) "출석"이다 — 종전 두 사본의 동작 그대로(배지는 예외를 말하는 자리라
 *    무기록을 결석으로 단정하지 않는다).
 */
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import type { AttendanceMark } from "./types";

export function attendanceMarkOf(status: string | null | undefined): AttendanceMark {
  return status === "late"
    ? "지각"
    : status === "absent" || status === "early_leave"
      ? "결석"
      : "출석";
}

/**
 * 배지 값 상수 — 🔴 **비교에 쓰는 값**이지 화면 글자가 아니다.
 * 화면에서 이 낱말을 영어로 옮길 때 비교까지 같이 바꾸면 판정이 조용히 뒤집힌다.
 */
export const MARK_PRESENT: AttendanceMark = "출석";
export const MARK_LATE: AttendanceMark = "지각";
export const MARK_ABSENT: AttendanceMark = "결석";

/** 배지 값 → 출결 enum. 표기는 앱 전역 `attendanceLabelOf`를 그대로 지난다(표를 새로 만들지 않는다). */
const MARK_STATUS: Record<AttendanceMark, string> = {
  [MARK_PRESENT]: "present",
  [MARK_LATE]: "late",
  [MARK_ABSENT]: "absent",
};

/** 화면에 적을 배지 글자 — 인자를 안 주면 한국어(기존 호출부 무변경). */
export function attendanceMarkLabel(mark: AttendanceMark, lang: "ko" | "en" = "ko"): string {
  return attendanceLabelOf(MARK_STATUS[mark], lang) ?? mark;
}
