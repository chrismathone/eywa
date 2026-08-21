/**
 * 출결 '적용된 칸' 방송 — 같은 문서 안의 다른 화면에게 *"서버가 방금 이 칸들을 기록했다"* 를 알린다.
 *
 * 왜 필요한가(원장 제보 2026-08-20 *"상단에서 출석하면 수업보고서에 연동이 안되는것 같은데"*):
 * 원스크린 상단 스트립의 「전원 출석」은 `attendance_records`에 **정상 기록**되지만, 같은 페이지 아래
 * 원스크린 본문은 서버 로스터를 **마운트 1회만** 클라 state로 복사한다. 스트립이 부르는
 * `router.refresh()`는 클라 state를 보존하므로 새 로스터가 무시되고, 출결 알약·'일괄 출석 N'·발송 칸이
 * 새로고침 전까지 낡은 채로 남는다.
 *
 * 🔴 **props 병합(`initial`이 바뀌면 state에 머지)으로 고치지 않는다.** 서버 액션을 부를 때마다 현재
 *    라우트의 RSC 트리가 재적용되고(#102), 원스크린은 타이핑 800ms 디바운스로 세션 저장 액션을 수시로
 *    부른다 — 먼저 출발한 낡은 payload가 방금 찍은 알약을 되돌릴 수 있다(조용한 회귀). 이 이벤트는
 *    서버가 **실제로 기록한 칸**(`applied`)만 실으므로 되돌림 위험이 0이다.
 *
 * ⚠️ **범위는 같은 문서(window) 하나뿐이다** — 창(iframe)·다른 탭은 대상이 아니다. BroadcastChannel은
 *    같은 문서 안의 자기 자신에게는 전달되지 않아 정작 이 버그(한 문서 안의 스트립↔본문)를 못 고친다.
 *    크로스 창 동기화가 필요해지면 이 버스를 넓히지 말고 별도 경로를 만들 것.
 * ⚠️ `import "server-only"` 금지 — 클라 컴포넌트가 import한다(#61).
 */

export const ATTENDANCE_APPLIED_EVENT = "eywa:attendance-applied";

export type AttendanceAppliedDetail = {
  /** 기록한 날짜 YYYY-MM-DD(KST) — 구독자는 자기 화면 날짜와 다르면 무시한다(과거 날짜 원스크린 보호). */
  date: string;
  /** 기록한 상태(스트립은 "present"). raw status 그대로 — 축약하지 않는다. */
  status: string;
  /**
   * 저장에 **실제로 실은 교시**("HH:MM") — `setAttendanceBulk({ slotStart })`에 넘긴 값 그대로.
   * `null` = "그날 전체"(수학 규약, [slot-axis.ts](./slot-axis.ts)) 또는 옛 day-level 행 제자리 갱신.
   *
   * ⚠️ 구독자마다 쓰임이 다르다 — 원스크린·ECS 요약 카드는 **무시한다**(둘 다 반×하루 축이라 교시 키가
   *    없다). ECS 주간 시트만 이 값으로 칸을 정하고, `null`이면 그 날 **첫 교시 칸**에 붙인다
   *    (서버 `attendanceByStudentDate` 키 규칙과 같은 규약 — 규칙을 새로 지어내면 알약이 엉뚱한 칸에 붙는다).
   */
  slot: string | null;
  /** 서버가 **실제로 기록한** 칸만(액션 응답 `applied`). 요청했지만 걸러진 칸은 싣지 않는다. */
  cells: { studentId: string; classId: string }[];
};

/** 방송 — window가 없으면(SSR) 아무 일도 하지 않는다. */
export function publishAttendanceApplied(detail: AttendanceAppliedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AttendanceAppliedDetail>(ATTENDANCE_APPLIED_EVENT, { detail }),
  );
}

/** 구독 — 반환값이 해지 함수(useEffect가 그대로 돌려주면 된다). */
export function subscribeAttendanceApplied(
  cb: (detail: AttendanceAppliedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<AttendanceAppliedDetail>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener(ATTENDANCE_APPLIED_EVENT, handler);
  return () => window.removeEventListener(ATTENDANCE_APPLIED_EVENT, handler);
}
