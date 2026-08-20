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
import type { AttendanceMark } from "./types";

export function attendanceMarkOf(status: string | null | undefined): AttendanceMark {
  return status === "late"
    ? "지각"
    : status === "absent" || status === "early_leave"
      ? "결석"
      : "출석";
}
